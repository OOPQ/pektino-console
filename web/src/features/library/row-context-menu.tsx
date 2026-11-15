import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  Heart,
  ListPlus,
  Play,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type { Row } from '@/types'
import { cn } from '@/lib/utils'

export type RowMenuActions = {
  open: (token: string, autoplay?: boolean) => void
  download: (row: Row) => void
  fav: (row: Row) => void
  collection: (row: Row) => void
  watched: (row: Row) => void
  rate: (row: Row, value: number) => void
  recycle: (row: Row) => void
  copy: (row: Row) => void
  reveal: (row: Row) => void
  markDone: (row: Row) => void
  removeFromCollection?: (row: Row) => void
}

const itemClass =
  'relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 text-[11px] text-[color:var(--muted)] outline-none data-[highlighted]:bg-[color:var(--surface-3)] data-[highlighted]:text-[color:var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

export function RowContextMenu({
  row,
  actions,
  children,
}: {
  row: Row
  actions: RowMenuActions
  children: React.ReactNode
}) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="ui-popover min-w-[190px] p-1" style={{ zIndex: 45 }}>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.open(row.token, true)}>
            <Play className="size-3.5" /> 播放
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.open(row.token, false)}>
            <Eye className="size-3.5" /> 查看详情
          </ContextMenuPrimitive.Item>
          {row.source !== 'local' && row.page_url ? (
            <ContextMenuPrimitive.Item className={itemClass} onSelect={() => window.open(row.page_url, '_blank', 'noopener')}>
              <ExternalLink className="size-3.5" /> 打开原网页
            </ContextMenuPrimitive.Item>
          ) : null}
          <ContextMenuPrimitive.Separator className="my-1 h-px bg-[color:var(--border)]" />
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.download(row)}>
            <Download className="size-3.5" /> 下载
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.fav(row)}>
            <Heart className={cn('size-3.5', row.fav === '1' && 'fill-current text-[color:var(--danger)]')} />
            {row.fav === '1' ? '取消收藏' : '收藏'}
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.collection(row)}>
            <ListPlus className="size-3.5" /> 加入合集
          </ContextMenuPrimitive.Item>
          {actions.removeFromCollection ? (
            <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.removeFromCollection!(row)}>
              <X className="size-3.5" /> 移除合集
            </ContextMenuPrimitive.Item>
          ) : null}
          <ContextMenuPrimitive.Sub>
            <ContextMenuPrimitive.SubTrigger className={itemClass}>
              <Star className="size-3.5" /> 评分
              <ChevronRight className="ml-auto size-3.5" />
            </ContextMenuPrimitive.SubTrigger>
            <ContextMenuPrimitive.Portal>
              <ContextMenuPrimitive.SubContent className="ui-popover min-w-[110px] p-1" style={{ zIndex: 46 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <ContextMenuPrimitive.Item key={n} className={itemClass} onSelect={() => actions.rate(row, n)}>
                    <Star className={cn('size-3.5', Number(row.rating) >= n && 'fill-current text-[color:var(--warning)]')} /> {n} 星
                  </ContextMenuPrimitive.Item>
                ))}
                <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.rate(row, 0)}>
                  清除评分
                </ContextMenuPrimitive.Item>
              </ContextMenuPrimitive.SubContent>
            </ContextMenuPrimitive.Portal>
          </ContextMenuPrimitive.Sub>
          <ContextMenuPrimitive.Separator className="my-1 h-px bg-[color:var(--border)]" />
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.markDone(row)}>
            <Check className="size-3.5" /> 标记完成
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.watched(row)}>
            <Eye className="size-3.5" /> {row.last_play ? '取消已看' : '标记已看'}
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className={itemClass} onSelect={() => actions.copy(row)}>
            <Copy className="size-3.5" /> 复制链接
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className={itemClass}
            disabled={!row.file_name}
            onSelect={() => actions.reveal(row)}
          >
            <FolderOpen className="size-3.5" /> 定位文件
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Separator className="my-1 h-px bg-[color:var(--border)]" />
          <ContextMenuPrimitive.Item className={cn(itemClass, 'text-[color:var(--danger)]')} onSelect={() => actions.recycle(row)}>
            <Trash2 className="size-3.5" /> 移入回收站
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
