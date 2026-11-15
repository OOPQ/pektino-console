import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-[34px] w-full rounded-[9px] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 text-[12px] text-[color:var(--foreground)] placeholder:text-[color:var(--subtle)] focus-visible:border-[color:var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:color-mix(in_srgb,var(--ring)_55%,transparent)]',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
