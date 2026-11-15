import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Pause,
  Play,
  Star,
  X,
} from 'lucide-react'
import type { MediaConfig, Row } from '@/types'
import { cn, copyText, formatCount, formatDate, mediaUrl, rowTitle, statusOf } from '@/lib/utils'
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
  media?: MediaConfig
  onClose: () => void
  onNavigate: (token: string) => void
  onFav: (row: Row) => void
}

export function PreviewDialog({ rows, token, media, onClose, onNavigate, onFav }: Props) {
  const index = React.useMemo(() => rows.findIndex(r => r.token === token), [rows, token])
  const row = index >= 0 ? rows[index] : null
  const [playing, setPlaying] = React.useState(false)
  const [videoError, setVideoError] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    setPlaying(false)
    setVideoError(false)
    setCopied(false)
  }, [token])

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

  if (!row) return null

  const canPlay = Boolean(row.file_name && media?.base && media?.key)
  const videoSrc = canPlay ? mediaUrl(media!.base, media!.key, row.token, Number(row.last_seen?.replace(/\D/g, '').slice(-9)) || 0) : ''
  const source = statusOf(row.status)

  const copy = async () => {
    if (await copyText(row.page_url || row.url)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <Dialog open={!!token} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        title="条目详情"
        description={`${index + 1} / ${rows.length} · ${row.token}`}
        bodyClassName="flex min-h-0 p-0"
        className="w-[min(1100px,calc(100vw-48px))]"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="hidden text-[9.5px] text-[color:var(--subtle)] md:inline">
              空格播放 / F 全屏 / M 静音 / Ctrl+←→ 切换
            </span>
            <div className="ml-auto flex items-center gap-1.5">
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
        <div className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden bg-[#05080c] p-3">
          {playing && !videoError ? (
            <video
              key={row.token}
              src={videoSrc}
              poster={`/api/cover?token=${encodeURIComponent(row.token)}&full=1`}
              controls
              autoPlay
              playsInline
              onError={() => { setVideoError(true); setPlaying(false) }}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            <>
              <CoverImage token={row.token} full fit="contain" alt={rowTitle(row)} className="absolute inset-0 h-full w-full" />
              {canPlay ? (
                <Button
                  size="md"
                  variant="outline"
                  className="relative z-10 border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/70"
                  onClick={() => { setVideoError(false); setPlaying(true) }}
                >
                  <Play className="size-4 fill-current" /> 播放
                </Button>
              ) : (
                <Badge tone="default" className="relative z-10 border-white/15 bg-black/55 text-white">
                  本地还没有这个文件
                </Badge>
              )}
            </>
          )}

          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between">
            <div className="pointer-events-auto">
              <IconButton label="上一项" onClick={() => prev && onNavigate(prev.token)} disabled={!prev}>
                <ChevronLeft className="size-4" />
              </IconButton>
            </div>
            {playing && !videoError ? (
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto border-white/20 bg-black/55 text-white backdrop-blur"
                onClick={() => setPlaying(false)}
              >
                <Pause className="size-3.5" /> 收起
              </Button>
            ) : null}
            <div className="pointer-events-auto">
              <IconButton label="下一项" onClick={() => next && onNavigate(next.token)} disabled={!next}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          </div>
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
