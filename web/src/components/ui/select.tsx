import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }

type SelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  className,
  disabled,
  ...rest
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={rest['aria-label']}
        className={cn(
          'flex h-[34px] min-w-0 items-center justify-between gap-2 rounded-[9px] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 text-[12px] text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:color-mix(in_srgb,var(--ring)_55%,transparent)] disabled:opacity-50',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={<span className="text-[color:var(--subtle)]">{placeholder}</span>} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-[color:var(--subtle)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          className="ui-popover z-[80] max-h-[280px] min-w-[var(--radix-select-trigger-width)] overflow-hidden"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map(option => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex h-8 cursor-pointer select-none items-center rounded-md pl-2.5 pr-8 text-[12px] text-[color:var(--muted)] outline-none data-[highlighted]:bg-[color:var(--surface-3)] data-[highlighted]:text-[color:var(--foreground)]"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="size-3.5 text-[color:var(--primary-2)]" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
