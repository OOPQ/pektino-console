import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Camera,
  Check,
  Pencil,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FastForward,
  List,
  Maximize,
  Minimize,
  Pause,
  Volume2,
  VolumeX,
  Play,
  Star,
  X,
} from 'lucide-react'
import type { DownloadItem, MediaConfig, Row, Snapshot } from '@/types'
import { cn, copyText, formatCount, formatDate, formatTime, mediaUrl, rowTitle, statusOf } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { post } from '@/lib/api'
import { unlockAudio } from '@/lib/sound'
import { confirmAction } from '@/store/confirm'
import { useUiStore } from '@/store/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { RatingInput } from '@/components/rating-input'
import { downloadButtonLabel, isDownloadBusy } from './download-status'
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
  downloadItem?: DownloadItem
}

export function PreviewDialog({ rows, token, autoplay = false, media, onClose, onNavigate, onFav, downloadItem }: Props) {
  const index = React.useMemo(() => rows.findIndex(r => r.token === token), [rows, token])
  const row = index >= 0 ? rows[index] : null
  const [playing, setPlaying] = React.useState(false)
  const [videoReady, setVideoReady] = React.useState(false)
  const [videoError, setVideoError] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [seek, setSeek] = React.useState<number | null>(null)
  const [busySnap, setBusySnap] = React.useState(false)
  const [pendingSnap, setPendingSnap] = React.useState<{ id: string; name: string } | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [collectionsEditing, setCollectionsEditing] = React.useState(false)
  const [hoverSnap, setHoverSnap] = React.useState<Snapshot | null>(null)
  const [timelineOpen, setTimelineOpen] = React.useState(false)
  const [volumeHint, setVolumeHint] = React.useState('')
  const [accelerating, setAccelerating] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [volume, setVolume] = React.useState(1)
  const [dragging, setDragging] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [playbackRate, setPlaybackRate] = React.useState(1)
  const resumeApplied = React.useRef(false)
  const lastResumeSave = React.useRef(0)
  const [hoverTime, setHoverTime] = React.useState<number | null>(null)
  const [hoverPct, setHoverPct] = React.useState(0)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const longPressRate = useUiStore(s => s.longPressRate)
  const bumpCoverRev = useUiStore(s => s.bumpCoverRev)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
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
  const snapshotJobsQuery = useQuery<{ items: Array<{ id: string; name: string; status: string; error?: string }> }>({
    queryKey: ['snapshot-jobs', token],
    queryFn: async () => {
      const res = await fetch(`/api/snapshot/jobs?token=${encodeURIComponent(token || '')}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('读取快照任务失败')
      return res.json()
    },
    enabled: !!token && !!pendingSnap,
    refetchInterval: 1000,
  })

  React.useEffect(() => {
    if (!pendingSnap) return
    const job = (snapshotJobsQuery.data?.items || []).find(item => item.id === pendingSnap.id)
    if (!job) return
    if (job.status === 'done') {
      toast.success('快照已生成')
      qc.invalidateQueries({ queryKey: ['snapshots', token] })
      setPendingSnap(null)
    setAccelerating(false)
    } else if (job.status === 'failed') {
      toast.error(job.error || '快照生成失败')
      setPendingSnap(null)
    setAccelerating(false)
    }
  }, [snapshotJobsQuery.data, pendingSnap, qc, token])
  const collectionsQuery = useQuery<{ items: Array<{ id: number; name: string; color: string; has: boolean }> }>({
    queryKey: ['collections', token],
    queryFn: async () => {
      const res = await fetch(`/api/collections?token=${encodeURIComponent(token || '')}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集失败')
      return res.json()
    },
    enabled: !!token,
    staleTime: 3_000,
  })
  const canPlay = Boolean(row?.file_name && media?.base && media?.key)

  React.useEffect(() => {
    setPlaying(Boolean(autoplay && canPlay))
    setVideoReady(false)
    setVideoError(false)
    setCopied(false)
    setSeek(null)
    setVolumeHint('')
    setCurrentTime(0)
    setDuration(Number(row?.seconds) || 0)
    setIsPlaying(false)
    setIsMuted(false)
    setHoverSnap(null)
    setPendingSnap(null)
    setAccelerating(false)
  }, [token, autoplay, canPlay, row?.seconds])

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
      setAccelerating(false)
      hintTimer = window.setTimeout(() => setVolumeHint(''), 1200)
    }
    const blurActive = () => { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) a.blur() }
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable]')) return
      if (e.ctrlKey) return
      if (e.key === ' ') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.repeat) return
        spaceAt = performance.now()
        const v = videoRef.current
        if (!v) {
          if (canPlay) setPlaying(true)
          return
        }
        if (!v.paused) { v.playbackRate = longPressRate; setAccelerating(true) }
        blurActive()
        return
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const v = videoRef.current
        if (!v) return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5)
        if (e.key === 'ArrowRight') v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5)
        if (e.key === 'ArrowUp') { v.volume = Math.min(1, v.volume + 0.05); showVolume(v) }
        if (e.key === 'ArrowDown') { v.volume = Math.max(0, v.volume - 0.05); showVolume(v) }
        blurActive()
        return
      }
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const value = Number(e.key)
        blurActive()
        void post<{ ok: boolean; error?: string }>('/api/rate', { tokens: [token], value }).then(r => {
          if (r.ok) { toast.success(`已评分 ${value} 星`); qc.invalidateQueries({ queryKey: ['state'] }) }
          else toast.error(r.error || '评分失败')
        })
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        e.stopImmediatePropagation()
        blurActive()
        void post<{ ok: boolean; error?: string }>('/api/rate', { tokens: [token], value: 0 }).then(r => {
          if (r.ok) { toast.success('已清除评分'); qc.invalidateQueries({ queryKey: ['state'] }) }
          else toast.error(r.error || '评分失败')
        })
        return
      }
      const v = videoRef.current
      if (!v) return
if (e.key === 'm' || e.key === 'M') { v.muted = !v.muted; showVolume(v); blurActive() }
if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopImmediatePropagation(); toggleStageFullscreen(); blurActive() }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      e.preventDefault()
        e.stopImmediatePropagation()
      const v = videoRef.current
      if (!v) return
      const held = performance.now() - spaceAt
      v.playbackRate = playbackRate
      setAccelerating(false)
      blurActive()
      if (held < 250) {
        if (v.paused) { void v.play().catch(() => {}); setPlaying(true) }
        else v.pause()
      } else {
        v.playbackRate = playbackRate
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.clearTimeout(hintTimer)
      setAccelerating(false)
    }
  }, [token, canPlay, qc, longPressRate, playbackRate])


  if (!row) return null

  const videoSrc = canPlay ? mediaUrl(media!.base, media!.key, row.token, Number(row.last_seen?.replace(/\D/g, '').slice(-9)) || 0) : ''
  const source = statusOf(row.status)
  const memberships = collectionsQuery.data?.items || []

  const copy = async () => {
    if (await copyText(row.page_url || row.url)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  const takeSnapshot = async () => {
    if (!canPlay || busySnap || pendingSnap) return
    setBusySnap(true)
    try {
      const time = videoRef.current?.currentTime || 0
      const r = await post<{ ok: boolean; error?: string; time?: number; pending?: boolean; id?: string; name?: string }>('/api/snapshot', { token: row.token, time })
      if (!r.ok) throw new Error(r.error || '快照失败')
      if (r.pending && r.id && r.name) {
        setPendingSnap({ id: r.id, name: r.name })
        toast.success(`快照生成中${r.time != null ? ` · ${formatTime(r.time)}` : ''}`)
        return
      }
      toast.success(`快照已保存${r.time != null ? ` · ${formatTime(r.time)}` : ''}`)
      qc.invalidateQueries({ queryKey: ['snapshots', row.token] })
      bumpCoverRev()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusySnap(false)
    }
  }

  const deleteSnapshot = async (name: string) => {
    if (!(await confirmAction({ title: '删除快照', description: '删除这张进度快照？只删除图片，不删除视频。', confirmText: '删除', danger: true }))) return
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/snapshot/delete', { token: row.token, name })
      if (!r.ok) throw new Error(r.error || '删除失败')
      toast.success('快照已删除')
      qc.invalidateQueries({ queryKey: ['snapshots', row.token] })
      bumpCoverRev()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const setSnapshotCover = async (name: string) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/snapshot/cover', { token: row.token, name })
      if (!r.ok) throw new Error(r.error || '设置封面失败')
      toast.success(name ? '已设为封面' : '已恢复默认封面')
      qc.invalidateQueries({ queryKey: ['snapshots', row.token] })
      bumpCoverRev()
      bumpCoverRev()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const setRating = async (value: number) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/rate', { tokens: [row.token], value })
      if (!r.ok) throw new Error(r.error || '评分失败')
      toast.success(value ? `已评分 ${value} 星` : '已清除评分')
      qc.invalidateQueries({ queryKey: ['state'] })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const download = async () => {
    unlockAudio()
    if (downloading) return
    if (!(await confirmAction({ title: '开始下载', description: `把「${rowTitle(row)}」加入下载队列？`, confirmText: '开始下载' }))) return
    setDownloading(true)
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/download', { tokens: [row.token], status: 'new' })
      if (!r.ok) throw new Error(r.error || '开始下载失败')
      toast.success('已加入下载队列', { action: { label: '查看队列', onClick: () => navigate('/queue') } })
      qc.invalidateQueries({ queryKey: ['state'] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  const toggleCollection = async (col: { id: number; name: string; has: boolean }) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', {
        action: col.has ? 'remove' : 'add',
        id: col.id,
        tokens: [row.token],
      })
      if (!r.ok) throw new Error(r.error || '操作失败')
      toast.success(col.has ? `已移出「${col.name}」` : `已加入「${col.name}」`)
      qc.invalidateQueries({ queryKey: ['collections'] })
      qc.invalidateQueries({ queryKey: ['state'] })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const totalDuration = duration || Number(row.seconds) || 0
  const snapshotClusters = (() => {
    if (!totalDuration) return [] as Array<{ time: number; items: Snapshot[] }>
    const items = [...snapshots].sort((a, b) => a.time - b.time)
    const groups: Array<{ time: number; items: Snapshot[] }> = []
    for (const s of items) {
      const pct = (s.time / totalDuration) * 100
      const last = groups[groups.length - 1]
      const lastPct = last ? (last.time / totalDuration) * 100 : -999
      if (last && Math.abs(pct - lastPct) < 2.5) last.items.push(s)
      else groups.push({ time: s.time, items: [s] })
    }
    return groups
  })()
  const progressPct = totalDuration ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100)) : 0

  const seekTo = (time: number) => {
    const max = totalDuration || Number(row.seconds) || 0
    const next = Math.max(0, Math.min(max, time))
    setCurrentTime(next)
    const v = videoRef.current
    if (v) {
      try { v.currentTime = next } catch (e) {}
      if (v.paused) { void v.play().catch(() => {}); setPlaying(true) }
    } else {
      setSeek(next)
      setPlaying(true)
    }
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { void v.play().catch(() => {}); setPlaying(true) }
    else v.pause()
  }

  const setRate = (rate: number) => {
    setPlaybackRate(rate)
    const v = videoRef.current
    if (v) v.playbackRate = rate
  }

  const saveResume = () => {
    const v = videoRef.current
    if (!v || !row) return
    try {
      if (v.currentTime > 3 && (v.duration ? v.currentTime < v.duration - 5 : true)) {
        localStorage.setItem(`pektino.resume.${row.token}`, String(Math.floor(v.currentTime)))
      }
    } catch { }
  }

  const timeFromPointer = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    let pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    let time = pct * totalDuration
    if (snapshots.length && totalDuration > 0) {
      const threshold = Math.max(0.6, Math.min(3, totalDuration * 0.004))
      const nearest = snapshots.reduce((best, s) => Math.abs(s.time - time) < Math.abs(best.time - time) ? s : best, snapshots[0])
      if (Math.abs(nearest.time - time) <= threshold) {
        time = nearest.time
        pct = time / totalDuration
      }
    }
    return { pct, time }
  }

  const seekFromPointer = (clientX: number, el: HTMLElement) => {
    const { pct, time } = timeFromPointer(clientX, el)
    setHoverTime(time)
    setHoverPct(pct * 100)
    seekTo(time)
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch (e) {
      toast.error('当前浏览器不支持画中画')
    }
  }

  const toggleStageFullscreen = () => {
    const el = stageRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {})
      return
    }
    const request = el.requestFullscreen || el.webkitRequestFullscreen
    if (!request) return
    void Promise.resolve(request.call(el)).catch(() => {})
  }


  return (
    <>
<Dialog open={!!token} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        onOpenAutoFocus={e => e.preventDefault()}
        onFocus={e => { if (e.target === e.currentTarget) e.currentTarget.blur() }}
        title="条目详情"
        description={`${index + 1} / ${rows.length} · ${row.token}`}
        bodyClassName="flex min-h-0 p-0"
        className="h-[min(92vh,780px)] w-[min(1180px,calc(100vw-48px))]"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="hidden text-[9.5px] text-[color:var(--subtle)] md:inline">
              空格 播放/暂停 · 长按 {longPressRate}× · ←→ 5s · ↑↓ 音量 · F 全屏 · M 静音
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setTimelineOpen(true)}>
                <List className="size-3.5" /> 时间轴
              </Button>
              <Button size="sm" variant="outline" onClick={takeSnapshot} disabled={!canPlay || busySnap || !!pendingSnap}>
                <Camera className="size-3.5" /> {busySnap ? '保存中…' : pendingSnap ? '生成中…' : '快照'}
              </Button>
              <Button size="sm" variant="outline" disabled title="下一批接入">
                画中画
              </Button>
              {!row.file_name ? (
                <Button size="sm" variant="outline" onClick={download} disabled={downloading || (!!downloadItem && isDownloadBusy(row, downloadItem))} title={downloadItem?.error || downloadButtonLabel(row, downloadItem)}>
                  <Download className="size-3.5" /> {downloading ? '提交中…' : downloadButtonLabel(row, downloadItem)}
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button size="sm" variant="ghost">
                  关闭
                </Button>
              </DialogClose>
            </div>
          </div>
        }
      >
        <div ref={stageRef} data-preview-stage className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#05080c]">
          <CoverImage token={row.token} full fit="contain" alt={rowTitle(row)} className={cn('absolute inset-0 h-full w-full transition-opacity', videoReady ? 'opacity-0' : 'opacity-100')} />

          {playing && !videoError ? (
            <video
              ref={videoRef}
              key={row.token}
              src={videoSrc}
              poster={`/api/cover?token=${encodeURIComponent(row.token)}&full=1`}
              autoPlay
              playsInline
              preload="auto"
              muted={isMuted}
onTimeUpdate={e => { const t = e.currentTarget.currentTime; setCurrentTime(t); if (t > 3 && Date.now() - lastResumeSave.current > 5000) { lastResumeSave.current = Date.now(); try { localStorage.setItem(`pektino.resume.${row.token}`, String(Math.floor(t))) } catch { } } }}
onLoadedMetadata={e => { const d = e.currentTarget.duration || Number(row.seconds) || 0; setDuration(d); e.currentTarget.playbackRate = playbackRate; if (!resumeApplied.current) { resumeApplied.current = true; try { const saved = Number(localStorage.getItem(`pektino.resume.${row.token}`) || 0); if (saved > 3 && (!d || saved < d - 5)) { e.currentTarget.currentTime = saved; setCurrentTime(saved) } } catch { } } }}
              onDurationChange={e => setDuration(e.currentTarget.duration || Number(row.seconds) || 0)}
              onPlaying={() => { setVideoReady(true); setIsPlaying(true) }}
onPause={() => { setIsPlaying(false); saveResume() }}
onPlay={() => { setIsPlaying(true); if (videoRef.current) videoRef.current.playbackRate = playbackRate }}
              onVolumeChange={e => { setIsMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume) }}
              onCanPlay={() => setVideoReady(true)}
              onError={() => { setVideoError(true); setPlaying(false); setIsPlaying(false) }}
              className={cn(
                'absolute inset-0 z-10 h-full w-full object-contain outline-none transition-opacity duration-200',
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
            {playing && !videoReady && !videoError ? (
              <span className="rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[10px] text-white/80 backdrop-blur">加载视频…</span>
            ) : null}
          </div>

          {volumeHint ? (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[10px] text-white backdrop-blur">
              {volumeHint}
            </div>
          ) : null}




          {playing && !videoError ? (
            <div className="absolute inset-x-0 bottom-0 z-30 bg-[linear-gradient(0deg,rgba(0,0,0,.88),rgba(0,0,0,.35),transparent)] px-3 pb-4 pt-10">
              <div className="flex items-center gap-2">
                <IconButton label={isPlaying ? '暂停' : '播放'} size="sm" onClick={togglePlay}>
                  {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </IconButton>
                <span className="font-mono text-[10px] tabular-nums text-white/90">{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
                {accelerating ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--warning)]/35 bg-[color:var(--warning)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--warning)]">
                    <FastForward className="size-3" /> 正在加速播放 · {longPressRate}×
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <IconButton label={isMuted ? '取消静音' : '静音'} size="sm" onClick={() => { const v = videoRef.current; if (!v) return; v.muted = !v.muted; setIsMuted(v.muted) }}>
                    {isMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                  </IconButton>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    aria-label="音量"
                    onChange={e => { const v = videoRef.current; const next = Number(e.target.value); setVolume(next); setIsMuted(next === 0); if (v) { v.volume = next; v.muted = next === 0 } }}
                    className="h-1 w-16 cursor-pointer accent-[color:var(--primary)]"
                  />
                  <select value={playbackRate} aria-label="播放倍速" onChange={e => setRate(Number(e.target.value))} className="h-6 rounded border border-white/20 bg-black/55 px-1 text-[9px] text-white outline-none">
                    {[1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate} className="bg-[#111]">{rate}×</option>)}
                  </select>
                  <IconButton label={isFullscreen ? '退出全屏' : '全屏'} size="sm" onClick={toggleStageFullscreen}>
                    {isFullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
                  </IconButton>
                </div>
              </div>
              <div
                className="relative mt-2 h-4 touch-none cursor-pointer"
                role="slider"
                aria-label="播放进度"
                aria-valuemin={0}
                aria-valuemax={Math.round(totalDuration)}
                aria-valuenow={Math.round(currentTime)}
                onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setDragging(true); seekFromPointer(e.clientX, e.currentTarget) }}
                onPointerMove={e => { const { pct, time } = timeFromPointer(e.clientX, e.currentTarget); setHoverTime(time); setHoverPct(pct * 100); if (dragging) seekTo(time) }}
                onPointerUp={() => setDragging(false)}
                onPointerCancel={() => setDragging(false)}
                onPointerLeave={() => setHoverTime(null)}
              >
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-[color:var(--primary)]" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-white shadow" style={{ left: `${progressPct}%` }} />
                {snapshotClusters.map(cluster => {
                  const s = cluster.items[cluster.items.length - 1]
                  const count = cluster.items.length
                  return (
                    <button
                      key={cluster.items[0].name}
                      type="button"
                      title={count > 1 ? `${count} 个快照 · ${formatTime(cluster.time)}` : `快照 ${formatTime(cluster.time)}`}
                      aria-label={count > 1 ? `${count} 个快照，打开时间轴` : `跳转到快照 ${formatTime(cluster.time)}`}
                      onPointerDown={e => e.stopPropagation()}
                      onMouseEnter={() => setHoverSnap(s)}
                      onMouseLeave={() => setHoverSnap(null)}
                      onClick={() => { setHoverSnap(null); setHoverTime(null); if (count > 1) setTimelineOpen(true); else seekTo(s.time) }}
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-[color:var(--warning)] shadow-[0_0_0_3px_rgba(227,179,65,.18)] transition-transform hover:scale-125"
                      style={{ left: `${totalDuration ? Math.min(100, Math.max(0, (cluster.time / totalDuration) * 100)) : 0}%` }}
                    >
                      {count > 1 ? <span className="absolute -right-2 -top-2 grid min-w-3.5 place-items-center rounded-full bg-black px-1 text-[8px] leading-3.5 text-white">{count}</span> : null}
                    </button>
                  )
                })}
                {hoverSnap ? (
                  <div className="pointer-events-none absolute bottom-6 z-40 w-[150px] -translate-x-1/2 overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl" style={{ left: `${totalDuration ? Math.min(90, Math.max(10, (hoverSnap.time / totalDuration) * 100)) : 50}%` }}>
                    <img src={hoverSnap.url} alt="" className="aspect-video w-full object-cover" />
                    <div className="flex items-center justify-between px-1.5 py-1 text-[9px] text-white/80"><span>{formatTime(hoverSnap.time)}</span><span className="text-[8px] text-white/45">快照</span></div>
                  </div>
                ) : hoverTime != null ? (
                  <div className="pointer-events-none absolute bottom-6 z-40 -translate-x-1/2 rounded-md border border-white/20 bg-black/90 px-1.5 py-0.5 font-mono text-[9px] text-white shadow-xl" style={{ left: `${Math.min(90, Math.max(10, hoverPct))}%` }}>
                    {formatTime(hoverTime)}
                  </div>
                ) : null}
              </div>
            </div>
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
            <RatingInput value={row.rating} onChange={setRating} />
          </div>

          <div className="mt-2">
            <div className="flex items-center gap-2">
              <span className="ui-field-label">合集</span>
              <span className="text-[9px] text-[color:var(--subtle)]">{memberships.filter(c => c.has).length} 个</span>
              <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5" onClick={() => setCollectionsEditing(v => !v)}>
                <Pencil className="size-3" /> {collectionsEditing ? '完成' : '编辑'}
              </Button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(collectionsEditing ? memberships : memberships.filter(c => c.has)).map(col => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => toggleCollection(col)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] transition-colors',
                    col.has
                      ? 'border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_8%,transparent)] text-[color:var(--primary-2)]'
                      : 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted)] hover:border-[color:var(--border-strong)]',
                  )}
                >
                  <span className="size-1.5 rounded-full" style={{ background: col.color }} />
                  {col.name}
                  {col.has ? <Check className="size-2.5" /> : null}
                </button>
              ))}
              {!memberships.length ? <span className="text-[9px] text-[color:var(--subtle)]">还没有合集</span> : null}
              {!collectionsEditing && memberships.length && !memberships.some(c => c.has) ? <span className="text-[9px] text-[color:var(--subtle)]">未加入合集</span> : null}
            </div>
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
              className={cn(row.fav === '1' && 'border-[color:color-mix(in_srgb,var(--danger)_40%,var(--border))] text-[color:var(--danger)]')}
              onClick={() => onFav(row)}
            >
              <Star className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
              {row.fav === '1' ? '已收藏' : '收藏'}
            </Button>
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="size-3.5" /> {copied ? '已复制' : '复制链接'}
            </Button>
            {row.source !== 'local' && row.page_url ? (
              <Button size="sm" variant="outline" asChild>
                <a href={row.page_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> 原页面
                </a>
              </Button>
            ) : null}
          </div>

        </aside>
      </DialogContent>
    </Dialog>
    <TimelineDialog
      open={timelineOpen}
      onOpenChange={setTimelineOpen}
      snapshots={snapshots}
      onSeek={time => { setSeek(time); setPlaying(true); setTimelineOpen(false) }}
      onDelete={deleteSnapshot}
      onCover={setSnapshotCover}
    />
    {createPortal(
      <div className="pointer-events-none fixed inset-y-0 left-2 right-2 z-[75] flex items-center justify-between">
        <IconButton label="上一项" className="pointer-events-auto size-11 border-white/20 bg-black/60 text-white backdrop-blur hover:bg-black/75" onClick={() => prev && onNavigate(prev.token)} disabled={!prev}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <IconButton label="下一项" className="pointer-events-auto size-11 border-white/20 bg-black/60 text-white backdrop-blur hover:bg-black/75" onClick={() => next && onNavigate(next.token)} disabled={!next}>
          <ChevronRight className="size-5" />
        </IconButton>
      </div>,
      document.body,
    )}
    </>
  )
}

function TimelineDialog({
  open,
  onOpenChange,
  snapshots,
  onSeek,
  onDelete,
  onCover,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshots: Snapshot[]
  onSeek: (time: number) => void
  onDelete: (name: string) => void
  onCover: (name: string) => void
}) {
  const ordered = React.useMemo(() => [...snapshots].sort((a, b) => a.time - b.time), [snapshots])
  const hasCover = ordered.some(s => s.isCover)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={e => e.preventDefault()}
        onFocus={e => { if (e.target === e.currentTarget) e.currentTarget.blur() }}
        title="播放时间轴"
        description={`${snapshots.length} 个进度快照 · 按时间串联`}
        className="w-[min(700px,calc(100vw-40px))]"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => onCover('')} disabled={!hasCover}>恢复默认封面</Button>
            <span className="hidden text-[9.5px] text-[color:var(--subtle)] sm:inline">快照保存在项目 data/snapshots</span>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        }
      >
        <div className="max-h-[500px] overflow-auto p-4">
          {!ordered.length ? (
            <div className="py-12 text-center text-[11px] text-[color:var(--subtle)]">还没有快照，播放时点「快照」记录当前进度。</div>
          ) : (
            <div className="relative pl-8">
              <div className="absolute bottom-3 left-[11px] top-3 w-px bg-[color:var(--border-strong)]" />
              {ordered.map((s, index) => (
                <div key={s.name} className="relative pb-3 last:pb-0">
                  <span className={cn('absolute -left-8 top-3 grid size-6 place-items-center rounded-full border text-[9px] font-semibold', s.isCover ? 'border-[color:var(--danger)] bg-[color:var(--danger)] text-white' : 'border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--subtle)]')}>{index + 1}</span>
                  <div className={cn('rounded-lg border bg-[color:var(--surface-2)] p-2 transition-colors', s.isCover ? 'border-[color:color-mix(in_srgb,var(--danger)_45%,var(--border))]' : 'border-[color:var(--border)]')}>
                    <div className="flex items-center gap-2.5">
                      <img src={s.url} alt="" className="aspect-video w-[128px] shrink-0 rounded-md object-cover" loading="lazy" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[15px] font-semibold text-[color:var(--foreground)]">{formatTime(s.time)}</span>
                          {s.isCover ? <span className="rounded border border-[color:color-mix(in_srgb,var(--danger)_45%,var(--border))] px-1 py-0.5 text-[8px] text-[color:var(--danger)]">当前封面</span> : null}
                        </div>
                        <div className="mt-0.5 text-[9px] text-[color:var(--subtle)]">{s.createdAt}</div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => onSeek(s.time)}>跳转</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => onCover(s.isCover ? '' : s.name)}>{s.isCover ? '默认封面' : '设为封面'}</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[color:var(--danger)]" onClick={() => onDelete(s.name)}>删除</Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
