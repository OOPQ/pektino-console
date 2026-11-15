import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from './button'
import { Tooltip } from './tooltip'

type IconButtonProps = Omit<ButtonProps, 'size' | 'variant' | 'children'> & {
  label: string
  children: React.ReactNode
  tone?: 'default' | 'danger'
  size?: 'default' | 'sm' | 'lg'
}

export function IconButton({
  label,
  children,
  tone = 'default',
  size = 'default',
  className,
  ...props
}: IconButtonProps) {
  const sizeClass = size === 'sm' ? 'size-7 rounded-lg' : size === 'lg' ? 'size-[46px] rounded-xl' : 'size-[34px]'
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={label}
        className={cn(
          'border-[color:var(--border)] bg-[linear-gradient(180deg,var(--surface-3),var(--surface-2))] text-[color:var(--muted)] hover:text-[color:var(--foreground)]',
          tone === 'danger' && 'text-[color:var(--danger)] hover:border-[color:color-mix(in_srgb,var(--danger)_45%,var(--border))] hover:bg-[color:color-mix(in_srgb,var(--danger)_10%,var(--surface-2))]',
          sizeClass,
          className,
        )}
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  )
}
