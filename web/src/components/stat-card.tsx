import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  active,
  onClick,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  sub?: string
  active?: boolean
  onClick?: () => void
  tone?: 'default' | 'primary' | 'danger' | 'warning'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-[68px] min-w-0 flex-col justify-center rounded-[12px] border bg-[color:var(--surface)] px-3 text-left transition-colors',
        active
          ? 'border-[color:var(--primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]'
          : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]',
      )}
    >
      <span className="flex items-center gap-1 text-[9px] tracking-[.2px] text-[color:var(--subtle)]">
        <Icon className="size-3 opacity-70" />
        {label}
      </span>
      <span
        className={cn(
          'mt-0.5 truncate text-[20px] font-semibold leading-tight tracking-[-.4px]',
          tone === 'primary' && 'text-[color:var(--primary-2)]',
          tone === 'danger' && 'text-[color:var(--danger)]',
          tone === 'warning' && 'text-[color:var(--warning)]',
        )}
      >
        {value}
      </span>
      {sub ? <span className="truncate text-[9px] text-[color:var(--subtle)]">{sub}</span> : null}
    </button>
  )
}
