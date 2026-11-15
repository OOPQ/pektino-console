import * as React from 'react'
import { Copy, Download, Eye, Heart } from 'lucide-react'
import type { Row } from '@/types'
import { cn, formatCount, formatDate, rowTitle } from '@/lib/utils'
import { useUiStore } from '@/store/ui'
import { Card, CardBody, CardFooter, CardMedia, CardMeta, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { RatingInput } from '@/components/rating-input'
import { StatusBadge } from '@/components/status-badge'
import { CoverImage } from '@/components/cover-image'
import { RowContextMenu, type RowMenuActions } from './row-context-menu'

type Props = {
  rows: Row[]
  selected: string[]
  onToggle: (token: string) => void
  onOpen: (token: string, autoplay?: boolean) => void
  onFav: (row: Row) => void
  onRate: (row: Row, value: number) => void
  onDownload: (row: Row) => void
  menu: RowMenuActions
}

export function LibraryGallery({ rows, selected, onToggle, onOpen, onFav, onRate, onDownload, menu }: Props) {
  const density = useUiStore(s => s.density)
  const multi = useUiStore(s => s.multi)
  const [copied, setCopied] = React.useState<string | null>(null)

  const minWidth = density === 'large' ? 220 : density === 'compact' ? 150 : 182

  const copy = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.page_url || row.url)
      setCopied(row.token)
      window.setTimeout(() => setCopied(c => (c === row.token ? null : c)), 1600)
    } catch (e) {}
  }

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${minWidth}px,1fr))` }}
    >
      {rows.map(row => {
        const isSelected = selected.includes(row.token)
        return (
          <RowContextMenu key={row.token} row={row} actions={menu}>
            <Card
              className={cn(
                'group cursor-pointer overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[color:var(--border-strong)]',
                isSelected && 'border-[color:var(--primary)]',
              )}
              onClick={() => multi ? onToggle(row.token) : onOpen(row.token, false)}
            >
              <CardMedia className="aspect-[3/4]">
                <CoverImage token={row.token} full alt={rowTitle(row)} className="absolute inset-0" />

                {multi ? (
                  <div className="absolute left-2 top-2 z-10" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`选择 ${rowTitle(row)}`}
                      checked={isSelected}
                      onCheckedChange={() => onToggle(row.token)}
                      className="size-[18px] border-white/70 bg-white/90 text-[#111] shadow-lg backdrop-blur data-[state=checked]:bg-[color:var(--primary)] data-[state=checked]:text-white"
                    />
                  </div>
                ) : null}

                <div className="absolute right-2 top-2 z-10" onClick={e => e.stopPropagation()}>
                  <StatusBadge status={row.status} />
                </div>

                <div className="absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                  <span className="rounded-md border border-white/15 bg-black/55 px-1.5 py-0.5 text-[9px] text-white/85 backdrop-blur">
                    {row.duration || '—'}
                  </span>
                  <div className="flex items-center gap-1">
                    <IconButton
                      label="下载"
                      size="sm"
                      className="border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/70"
                      onClick={() => onDownload(row)}
                    >
                      <Download className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={row.fav === '1' ? '取消收藏' : '收藏'}
                      size="sm"
                      className={cn('border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/70', row.fav === '1' && 'text-[color:var(--warning)]')}
                      onClick={() => onFav(row)}
                    >
                      <Heart className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
                    </IconButton>
                  </div>
                </div>
              </CardMedia>

              <CardBody className="pb-2">
                <CardTitle className="text-[11.5px]">{row.title?.trim() || row.token}</CardTitle>
                <CardMeta>
                  {row.duration || '—'} · {row.res || '—'} · {formatDate(row.first_seen)}
                </CardMeta>
                <div className="mt-1.5 flex items-center gap-2 text-[9px] text-[color:var(--subtle)]">
                  <span className="inline-flex items-center gap-1"><Eye className="size-3" /> {formatCount(row.views)}</span>
                  <span className="inline-flex items-center gap-1"><Heart className="size-3" /> {formatCount(row.likes)}</span>
                  <span className="ml-auto">#{row.rank || '—'}</span>
                </div>
              </CardBody>

              <CardFooter className="py-1.5">
                <div onClick={e => e.stopPropagation()}>
                  <RatingInput value={row.rating} onChange={value => onRate(row, value)} />
                </div>
                <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                  <IconButton label={copied === row.token ? '已复制' : '复制链接'} size="sm" onClick={() => copy(row)}>
                    <Copy className={cn('size-3.5', copied === row.token && 'text-[color:var(--success)]')} />
                  </IconButton>
                </div>
              </CardFooter>
            </Card>
          </RowContextMenu>
        )
      })}
    </div>
  )
}
