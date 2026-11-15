import * as React from 'react'
import {
  ChevronLeft,
  Camera,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Pause,
  Play,
  Star,
  X,
} from 'lucide-react'
import type { MediaConfig, Row, Snapshot } from '@/types'
import { cn, copyText, formatCount, formatDate, mediaUrl, rowTitle, statusOf } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Stars } from '@/components/stars'
import { StatusBadge } from '@/components/status-badge'
import { CoverImage } from '@/components/cover-image'

type Props = {
  rows: Row[]
  token: string | null
  autoplay?: boolean
  media?: MediaConfig
  onClose: () => void
  onNavigate: (token: string) => void
  onFav: (row: Row) => void
}

export function PreviewDialog({ rows, token, autoplay = false, media, onClose, onNavigate, onFav }: Props) {
  const index = React.useMemo(() => rows.findIndex(r => r.token === token), [rows, token])
  const row = index >= 0 ? rows[index] : null
  const [playing, setPlaying] = React.useState(false)
  const [videoReady, setVideoReady] = React.useState(false)
  const [videoError, setVideoError] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [seek, setSeek] = React.useState<number | null>(null)
  const [busySnap, setBusySnap] = React.useState(false)
  const [volumeHint, setVolumeHint] = React.useState('')
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const qc = useQueryClient()
  const snapshotsQuery = useQuery<{ items: Snapshot[] }>({
    queryKey: ['snapshots', token],
    queryFn: async () => {
      const res = await fetch(`/api/snapshots?token=${encodeURIComponent(token || '')}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('读取快照失败')
      return res.json()
    },
    enabled: !!token,
    staleTime: 3_000,
  })
  const snapshots = snapshotsQuery.data?.items || []
  const canPlay = Boolean(row?.file_name && media?.base && media?.key)

  React.useEffect(() => {
    setPlaying(Boolean(autoplay && canPlay))
    setVideoReady(false)
    setVideoError(false)
    setCopied(false)
    setSeek(null)
    setVolumeHint('')
  }, [token, autoplay, canPlay])

  const prev = index > 0 ? rows[index - 1] : null
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null

  React.useEffect(() => {
    if (!row) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault()
        onNavigate(prev.token)
      }
      if (e.key === 'ArrowRight' && next) {
        e.preventDefault()
        onNavigate(next.token)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, prev, next, onNavigate])

  React.useEffect(() => {
    if (seek == null) return
    const v = videoRef.current
    if (!v) return
    try { v.currentTime = seek } catch (e) {}
    void v.play().catch(() => {})
    setSeek(null)
  }, [seek, playing, token])

  React.useEffect(() => {
    if (!token) return
    let spaceAt = 0
    let hintTimer = 0
    const showVolume = (v: HTMLVideoElement) => {
      const pct = Math.round(v.volume * 100)
      setVolumeHint(v.muted ? '静音' : `音量 ${pct}%`)
      window.clearTimeout(hintTimer)
      hintTimer = window.setTimeout(() => setVolumeHint(''), 1200)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable]')) return
      if (e.ctrlKey) return
      if (e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        spaceAt = performance.now()
        const v = videoRef.current
        if (!v) {
          if (canPlay) setPlaying(true)
          return
        }
        if (!v.paused) v.playbackRate = 2
        return
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const v = videoRef.current
        if (!v) return
        e.preventDefault()
        if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5)
        if (e.key === 'ArrowRight') v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5)
        if (e.key === 'ArrowUp') { v.volume = Math.min(1, v.volume + 0.05); showVolume(v) }
        if (e.key === 'ArrowDown') { v.volume = Math.max(0, v.volume - 0.05); showVolume(v) }
        return
      }
      const v = videoRef.current
      if (!v) return
      if (e.key === 'm' || e.key === 'M') { v.muted = !v.muted; showVolume(v) }
      if (e.key === 'f' || e.key === 'F') { void v.requestFullscreen?.().catch(() => {}) }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      e.preventDefault()
      const v = videoRef.current
      if (!v) return
      const held = performance.now() - spaceAt
      if (held < 250) {
        if (v.paused) { void v.play().catch(() => {}); setPlaying(true) }
        else v.pause()
      } else {
        v.playbackRate = 1
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.clearTimeout(hintTimer)
    }
  }, [token, canPlay])

  if (!row) return null

  const videoSrc = canPlay ? mediaUrl(media!.base, media!.key, row.token, Number(row.last_seen?.replace(/\D/g, '').slice(-9)) || 0) : ''
  const source = statusOf(row.status)

  const copy = async () => {
    if (await copyText(row.page_url || row.url)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  const takeSnapshot = async () => {
    if (!canPlay || busySnap) return
    setBusySnap(true)
    try {
      const time = videoRef.current?.currentTime || 0
      const r = await post<{ ok: boolean; error?: string; time?: number }>('/api/snapshot', { token: row.token, time })
      if (!r.ok) throw new Error(r.error || '快照失败')
      toast.success(`快照已保存${r.time != null ? ` · ${r.time.toFixed(1)}s` : ''}`)
      qc.invalidateQueries({ queryKey: ['snapshots', row.token] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusySnap(false)
    }
  }

  return (
    <Dialog open={!!token} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        title="条目详情"
        description={`${index + 1} / ${rows.length} · ${row.token}`}
        bodyClassName="flex min-h-0 p-0"
        className="h-[min(92vh,780px)] w-[min(1180px,calc(100vw-48px))]"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="hidden text-[9.5px] text-[color:var(--subtle)] md:inline">
              空格 播放/暂停 · 长按加速 · ←→ 5s · ↑↓ 音量 · F 全屏 · M 静音
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={takeSnapshot} disabled={!canPlay || busySnap}>
                <Camera className="size-3.5" /> {busySnap ? '保存中…' : '快照'}
              </Button>
              <Button size="sm" variant="outline" disabled title="下一批接入">
                画中画
              </Button>
              <Button size="sm" variant="outline" disabled title="下一批接入">
                <Download className="size-3.5" /> 下载
              </Button>
              <DialogClose asChild>
                <Button size="sm" variant="ghost">
                  关闭
                </Button>
              </DialogClose>
            </div>
          </div>
        }
      >
        <div className="relative flex min-h-[480px] flex-1 items-center justify-center overflow-hidden bg-[#05080c]">
          <CoverImage token={row.token} full fit="contain" alt={rowTitle(row)} className="absolute inset-0 h-full w-full" />

          {playing && !videoError ? (
            <video
              ref={videoRef}
              key={row.token}
              src={videoSrc}
              poster={`/api/cover?token=${encodeURIComponent(row.token)}&full=1`}
              controls
              autoPlay
              playsInline
              preload="auto"
              onCanPlay={() => setVideoReady(true)}
              onPlaying={() => setVideoReady(true)}
              onError={() => { setVideoError(true); setPlaying(false) }}
              className={cn(
                'absolute inset-0 z-10 h-full w-full object-contain transition-opacity duration-200',
                videoReady ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : null}

          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
            {!playing && canPlay ? (
              <Button
                size="md"
                variant="outline"
                className="pointer-events-auto border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/70"
                onClick={() => { setVideoError(false); setVideoReady(false); setPlaying(true) }}
              >
                <Play className="size-4 fill-current" /> 播放
              </Button>
            ) : null}
            {!playing && !canPlay ? (
              <Badge tone="default" className="border-white/15 bg-black/55 text-white">本地还没有这个文件</Badge>
            ) : null}
            {playing && !videoReady && !videoError ? (
              <span className="rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[10px] text-white/80 backdrop-blur">加载视频…</span>
            ) : null}
          </div>

          {volumeHint ? (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[10px] text-white backdrop-blur">
              {volumeHint}
            </div>
          ) : null}

          <div className="absolute left-2 top-1/2 z-30 -translate-y-1/2">
            <IconButton label="上一项" onClick={() => prev && onNavigate(prev.token)} disabled={!prev}>
              <ChevronLeft className="size-4" />
            </IconButton>
          </div>
          <div className="absolute right-2 top-1/2 z-30 -translate-y-1/2">
            <IconButton label="下一项" onClick={() => next && onNavigate(next.token)} disabled={!next}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>

          {playing && !videoError ? (
            <Button
              size="sm"
              variant="outline"
              className="absolute right-2 top-2 z-30 border-white/20 bg-black/55 text-white backdrop-blur"
              onClick={() => setPlaying(false)}
            >
              <Pause className="size-3.5" /> 收起视频
            </Button>
          ) : null}
        </div>

        <aside className="w-[320px] shrink-0 overflow-auto border-l border-[color:var(--border)] p-4">
          <div className="text-[9px] tracking-[.9px] text-[color:var(--subtle)]">ITEM / {index + 1} OF {rows.length}</div>
          <h2 className="mt-1 break-all text-[15px] font-semibold leading-snug">{rowTitle(row)}</h2>
          <div className="mt-3 flex items-baseline gap-2">
            <b className="text-[24px] leading-none tracking-[-.5px]">{row.duration || '—'}</b>
            <span className="text-[10px] text-[color:var(--subtle)]">{row.res || '—'}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={row.status} />
            <Stars value={row.rating} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="站点观看" value={formatCount(row.views)} />
            <Stat label="点赞" value={formatCount(row.likes)} />
            <Stat label="来源" value={row.source || '—'} />
            <Stat label="文件大小" value={row.file_size ? `${(Number(row.file_size) / 1024 / 1024).toFixed(1)} MB` : '—'} />
          </div>

          <div className="mt-4 space-y-2 border-t border-[color:var(--border)] pt-3 text-[10px]">
            <div className="flex justify-between gap-3">
              <span className="text-[color:var(--subtle)]">入库</span>
              <span className="text-right text-[color:var(--muted)]">{formatDate(row.first_seen)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[color:var(--subtle)]">播放</span>
              <span className="text-right text-[color:var(--muted)]">{row.play_count || 0} 次</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[color:var(--subtle)]">状态</span>
              <span className="text-right text-[color:var(--muted)]">{source.label}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className={cn(row.fav === '1' && 'border-[color:color-mix(in_srgb,var(--warning)_40%,var(--border))] text-[color:var(--warning)]')}
              onClick={() => onFav(row)}
            >
              <Star className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
              {row.fav === '1' ? '已收藏' : '收藏'}
            </Button>
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="size-3.5" /> {copied ? '已复制' : '复制链接'}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={row.page_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> 原页面
              </a>
            </Button>
          </div>

          <div className="mt-4 border-t border-[color:var(--border)] pt-3">
            <div className="flex items-center justify-between">
              <span className="ui-field-label">进度快照</span>
              <span className="text-[9px] text-[color:var(--subtle)]">{snapshots.length} 张</span>
            </div>
            {snapshots.length ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {snapshots.slice(0, 9).map(s => (
                  <button
                    key={s.name}
                    type="button"
                    title={`跳转到 ${s.time.toFixed(1)}s`}
                    onClick={() => { setSeek(s.time); setPlaying(true) }}
                    className="group relative overflow-hidden rounded-md border border-[color:var(--border)] bg-black"
                  >
                    <img src={s.url} alt={`快照 ${s.time.toFixed(1)} 秒`} className="aspect-video w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" loading="lazy" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-[8px] text-white">{s.time.toFixed(1)}s</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[9px] leading-4 text-[color:var(--subtle)]">播放时点「快照」记录当前进度和画面，存在项目 data/snapshots。</div>
            )}
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-1.5">
      <div className="text-[9px] text-[color:var(--subtle)]">{label}</div>
      <div className="truncate text-[11px] font-medium">{value}</div>
    </div>
  )
}
