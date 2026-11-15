import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border text-[12px] font-medium transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border-[color:var(--primary)] bg-[linear-gradient(180deg,#4f93ff,#2f6fe4)] text-white hover:brightness-110',
        outline: 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--foreground)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-3)]',
        ghost: 'border-transparent bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--foreground)]',
        danger: 'border-[color:color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_10%,transparent)] text-[color:var(--danger)] hover:bg-[color:color-mix(in_srgb,var(--danger)_16%,transparent)]',
      },
      size: {
        sm: 'h-8 px-2.5',
        md: 'h-[34px] px-3',
        lg: 'h-9 px-4',
        icon: 'size-[34px] p-0',
        'icon-sm': 'size-7 p-0 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'Button'
