import { useConfirmStore } from '@/store/confirm'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function ConfirmDialog() {
  const { open, options, settle } = useConfirmStore()
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) settle(false) }}>
      <DialogContent
        title={options.title}
        className="w-[min(420px,calc(100vw-40px))]"
        footer={
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => settle(false)}>{options.cancelText || '取消'}</Button>
            <Button size="sm" variant={options.danger ? 'danger' : 'default'} onClick={() => settle(true)}>
              {options.confirmText || '确认'}
            </Button>
          </div>
        }
      >
        <div className="px-4 py-4 text-[12px] leading-6 text-[color:var(--muted)]">
          {options.description || '确定继续吗？'}
        </div>
      </DialogContent>
    </Dialog>
  )
}
