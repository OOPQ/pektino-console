import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_90%,transparent),var(--surface-2))] shadow-[0_10px_26px_rgba(0,0,0,.12)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardMedia({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative overflow-hidden bg-[#070b10]', className)} {...props} />
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 flex-1 px-3 py-2.5', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('truncate text-[12px] font-semibold text-[color:var(--foreground)]', className)} {...props} />
}

export function CardMeta({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-1 truncate text-[10px] text-[color:var(--subtle)]', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-auto flex items-center justify-between gap-2 border-t border-[color:var(--border)] px-3 py-2', className)}
      {...props}
    />
  )
}
