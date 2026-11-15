import * as React from 'react'
import { Copy, Eye, Heart, ListPlus, Play, Star } from 'lucide-react'
import type { Row } from '@/types'
import { cn, formatCount, formatDate, rowTitle } from '@/lib/utils'
import { Card, CardBody, CardFooter, CardMedia, CardMeta, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Stars } from '@/components/stars'
import { StatusBadge } from '@/components/status-badge'
import { CoverImage } from '@/components/cover-image'
import { RowContextMenu, type RowMenuActions } from './row-context-menu'

type Props = {
  rows: Row[]
  selected: string[]
  onToggle: (token: string) => void
  onOpen: (token: string, autoplay?: boolean) => void
  onFav: (row: Row) => void
  onCollection: (row: Row) => void
  onDownload: (row: Row) => void
  menu: RowMenuActions
}

export function LibraryGallery({ rows, selected, onToggle, onOpen, onFav, onCollection, onDownload, menu }: Props) {
  const [copied, setCopied] = React.useState<string | null>(null)

  const copy = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.page_url || row.url)
      setCopied(row.token)
      window.setTimeout(() => setCopied(c => (c === row.token ? null : c)), 1600)
    } catch (e) {}
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
      {rows.map(row => {
        const isSelected = selected.includes(row.token)
        return (
          <RowContextMenu key={row.token} row={row} actions={menu}>
          <Card
            className={cn(
              'group cursor-pointer transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[color:var(--border-strong)]',
              isSelected && 'border-[color:var(--primary)]',
            )}
            onClick={() => onOpen(row.token, true)}
          >
            <CardMedia className="aspect-[3/4]">
              <CoverImage token={row.token} full alt={rowTitle(row)} className="absolute inset-0" />
              <div className="absolute left-2 top-2 z-10" onClick={e => e.stopPropagation()}>
                <Checkbox
                  aria-label={`选择 ${rowTitle(row)}`}
                  checked={isSelected}
                  onCheckedChange={() => onToggle(row.token)}
                  className="size-[18px] border-white/70 bg-white/90 text-[#111] shadow-lg backdrop-blur data-[state=checked]:bg-[color:var(--primary)] data-[state=checked]:text-white"
                />
              </div>
              <div className="absolute right-2 top-2 z-10" onClick={e => e.stopPropagation()}>
                <StatusBadge status={row.status} />
              </div>
              <div className="absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-white/20 bg-black/55 px-2 text-[10px] text-white backdrop-blur hover:bg-black/70"
                  onClick={() => onOpen(row.token, true)}
                >
                  <Play className="size-3 fill-current" /> 播放
                </Button>
                <IconButton
                  label={row.fav === '1' ? '取消收藏' : '收藏'}
                  size="sm"
                  className={cn('border-white/20 bg-black/55 text-white backdrop-blur hover:bg-black/70', row.fav === '1' && 'text-[color:var(--warning)]')}
                  onClick={() => onFav(row)}
                >
                  <Star className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
                </IconButton>
              </div>
            </CardMedia>
            <CardBody className="pb-2">
              <CardTitle className="text-[11.5px]">{row.title?.trim() || row.token}</CardTitle>
              <CardMeta>
                {row.duration || '—'} · {row.res || '—'}
              </CardMeta>
              <div className="mt-1.5 flex items-center gap-2 text-[9px] text-[color:var(--subtle)]">
                <span className="inline-flex items-center gap-1"><Eye className="size-3" /> {formatCount(row.views)}</span>
                <span className="inline-flex items-center gap-1"><Heart className="size-3" /> {formatCount(row.likes)}</span>
                <span className="ml-auto">#{row.rank || '—'}</span>
              </div>
              <CardMeta>{formatDate(row.first_seen)}</CardMeta>
            </CardBody>
            <CardFooter className="py-1.5">
              <Stars value={row.rating} />
              <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                <IconButton label={row.fav === '1' ? '取消收藏' : '收藏'} size="sm" onClick={() => onFav(row)}>
                  <Heart className={cn('size-3.5', row.fav === '1' && 'fill-current text-[color:var(--warning)]')} />
                </IconButton>
                <IconButton label="加入合集" size="sm" onClick={() => onCollection(row)}>
                  <ListPlus className="size-3.5" />
                </IconButton>
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
