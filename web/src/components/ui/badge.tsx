import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] leading-[1.45]',
  {
    variants: {
      tone: {
        default: 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted)]',
        ok: 'border-[color:color-mix(in_srgb,var(--success)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_8%,transparent)] text-[color:var(--success)]',
        new: 'border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_8%,transparent)] text-[color:var(--primary-2)]',
        live: 'border-[color:color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,transparent)] text-[color:var(--warning)]',
        bad: 'border-[color:color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_8%,transparent)] text-[color:var(--danger)]',
        muted: 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--subtle)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
