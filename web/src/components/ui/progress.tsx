import * as React from 'react'
import { cn } from '@/lib/utils'

export function Progress({
  value,
  className,
  tone = 'primary',
}: {
  value: number
  className?: string
  tone?: 'primary' | 'success' | 'warning' | 'danger'
}) {
  const v = Math.max(0, Math.min(100, value || 0))
  const color =
    tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : tone === 'danger' ? 'var(--danger)' : 'var(--primary)'
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cn('h-[5px] w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_7%,transparent)]', className)}
    >
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${v}%`, background: color }} />
    </div>
  )
}
