import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Stars({ value, className }: { value: number | string; className?: string }) {
  const v = Math.max(0, Math.min(5, Math.round(Number(value) || 0)))
  return (
    <span className={cn('inline-flex items-center gap-[1px] text-[color:var(--warning)]', className)} aria-label={`评分 ${v} / 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn('size-3', i < v ? 'fill-current' : 'text-[color:var(--border-strong)]')} />
      ))}
    </span>
  )
}
