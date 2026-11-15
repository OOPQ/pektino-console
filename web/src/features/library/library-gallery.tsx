import * as React from 'react'
import { Check, Download, Eye, Heart } from 'lucide-react'
import type { DownloadItem, Row } from '@/types'
import { cn, formatCount, formatDate, rowTitle } from '@/lib/utils'
import { useUiStore } from '@/store/ui'
import { Card, CardBody, CardFooter, CardMedia, CardMeta, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { RatingInput } from '@/components/rating-input'
import { CoverImage } from '@/components/cover-image'
import { downloadButtonLabel, isDownloadBusy } from './download-status'
import { Button } from '@/components/ui/button'
import { RowContextMenu, type RowMenuActions } from './row-context-menu'

type Props = {
  rows: Row[]
  downloads: Map<string, DownloadItem>
  selected: string[]
  onToggle: (token: string) => void
  onOpen: (token: string, autoplay?: boolean) => void
  onFav: (row: Row) => void
  onRate: (row: Row, value: number) => void
  onDownload: (row: Row) => void
  menu: RowMenuActions
}

export function LibraryGallery({ rows, downloads, selected, onToggle, onOpen, onFav, onRate, onDownload, menu }: Props) {
  const density = useUiStore(s => s.density)
  const multi = useUiStore(s => s.multi)
  const minWidth = density === 'large' ? 220 : density === 'compact' ? 150 : 182

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${minWidth}px,1fr))` }}
    >
      {rows.map(row => {
        const isSelected = selected.includes(row.token)
        const dl = downloads.get(row.token)
        return (
          <RowContextMenu key={row.token} row={row} actions={menu}>
            <Card
              className={cn(
                'group cursor-pointer overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[color:var(--border-strong)]',
                isSelected && 'border-[color:var(--primary)]',
              )}
              onClick={() => multi ? onToggle(row.token) : onOpen(row.token, true)}
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

                <span className="absolute bottom-2 left-2 z-10 rounded-md border border-white/15 bg-black/55 px-2 py-0.5 text-[12px] font-semibold text-white/90 backdrop-blur">
                  {row.duration || '—'}
                </span>
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
                  {row.file_name ? (
                    <IconButton label="打开文件位置" size="sm" className="text-[color:var(--success)]" onClick={() => menu.reveal(row)}>
                      <Check className="size-3.5" />
                    </IconButton>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-1.5 text-[9px]"
                      disabled={!!dl && isDownloadBusy(row, dl)}
                      title={dl?.error || downloadButtonLabel(row, dl)}
                      onClick={() => onDownload(row)}
                    >
                      <Download className="size-3.5" /> {downloadButtonLabel(row, dl)}
                    </Button>
                  )}
                  <IconButton
                    label={row.fav === '1' ? '取消收藏' : '收藏'}
                    size="sm"
                    className={cn(row.fav === '1' && 'text-[color:var(--danger)]')}
                    onClick={() => onFav(row)}
                  >
                    <Heart className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
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
