import { Check, Copy, Download, Eye, Heart, Layers, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SelectionBar({
  count,
  onDownload,
  onCollection,
  onRecycle,
  onFav,
  onWatched,
  onMarkDone,
  onCopy,
  onClear,
}: {
  count: number
  onDownload: () => void
  onCollection: () => void
  onRecycle: () => void
  onFav: () => void
  onWatched: () => void
  onMarkDone: () => void
  onCopy: () => void
  onClear: () => void
}) {
  if (!count) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[12px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-2 py-1.5 shadow-[0_20px_60px_rgba(0,0,0,.5)]">
      <span className="whitespace-nowrap px-1.5 text-[10px] text-[color:var(--muted)]">已选 <b className="text-[color:var(--foreground)]">{count}</b></span>
      <Button size="sm" variant="default" className="h-7 px-2" onClick={onDownload}><Download className="size-3.5" /> 下载</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCollection}><Layers className="size-3.5" /> 合集</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onFav}><Heart className="size-3.5" /> 收藏</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onWatched}><Eye className="size-3.5" /> 已看</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onMarkDone}><Check className="size-3.5" /> 完成</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCopy}><Copy className="size-3.5" /> 复制</Button>
      <Button size="sm" variant="danger" className="h-7 px-2" onClick={onRecycle}><Trash2 className="size-3.5" /> 删除</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClear}><X className="size-3.5" /> 清空</Button>
    </div>
  )
}
