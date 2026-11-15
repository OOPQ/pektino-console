import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Drawer = DialogPrimitive.Root
export const DrawerClose = DialogPrimitive.Close
export const DrawerTrigger = DialogPrimitive.Trigger

type DrawerContentProps = {
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
} & Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'children'>

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ title, description, footer, children, className, bodyClassName, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-overlay" />
    <DialogPrimitive.Content ref={ref} className={cn('ui-drawer w-[min(480px,calc(100vw-28px))]', className)} {...props}>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border)] px-4 py-[11px]">
        <div className="min-w-0">
          <DialogPrimitive.Title className="truncate text-[12px] font-semibold tracking-[.2px]">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-0.5 truncate text-[10px] text-[color:var(--subtle)]">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        <DialogPrimitive.Close
          aria-label="关闭"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-3)] hover:text-[color:var(--foreground)]"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
      {footer ? (
        <div className="shrink-0 border-t border-[color:var(--border)] px-4 py-2.5">{footer}</div>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DrawerContent.displayName = 'DrawerContent'
