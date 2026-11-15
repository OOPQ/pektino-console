import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RatingInput({
  value,
  onChange,
  className,
  size = 'sm',
}: {
  value: number | string
  onChange: (value: number) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  const current = Math.max(0, Math.min(5, Math.round(Number(value) || 0)))
  const [hover, setHover] = React.useState(0)
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 5 }, (_, i) => {
        const n = i + 1
        const on = n <= (hover || current)
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} 星`}
            title={`${n} 星`}
            onMouseEnter={() => setHover(n)}
            onClick={e => {
              e.stopPropagation()
              onChange(n === current ? 0 : n)
            }}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]"
          >
            <Star className={cn(size === 'md' ? 'size-4' : 'size-3.5', on ? 'fill-current text-[color:var(--warning)]' : 'text-[color:var(--border-strong)]')} />
          </button>
        )
      })}
    </span>
  )
}
