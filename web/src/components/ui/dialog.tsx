import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

type DialogContentProps = {
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  hideClose?: boolean
} & Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'children'>

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ title, description, footer, children, className, bodyClassName, hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('ui-dialog w-[min(1100px,calc(100vw-48px))]', className)}
      {...props}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border)] px-4 py-[11px]">
        <div className="min-w-0">
          <DialogPrimitive.Title className="truncate text-[12px] font-semibold tracking-[.2px] text-[color:var(--foreground)]">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-0.5 truncate text-[10px] text-[color:var(--subtle)]">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {!hideClose ? (
          <DialogPrimitive.Close
            aria-label="关闭"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-3)] hover:text-[color:var(--foreground)]"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
      {footer ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'
