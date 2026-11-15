import { Dialog, DialogContent } from '@/components/ui/dialog'

const GROUPS = [
  {
    title: '媒体库',
    items: [
      ['R', '连续随机抽卡'],
      ['Ctrl / Cmd + K', '打开命令面板'],
      ['?', '显示快捷键说明'],
    ],
  },
  {
    title: '播放器',
    items: [
      ['空格', '播放 / 暂停'],
      ['长按空格', '临时加速（倍速可在设置里改）'],
      ['← / →', '后退 / 前进 5 秒'],
      ['↑ / ↓', '音量 ±5%'],
      ['F', '进入 / 退出全屏'],
      ['M', '静音 / 取消静音'],
      ['1–5', '评分'],
      ['0', '清除评分'],
      ['Esc', '关闭浮窗 / 返回'],
    ],
  },
]

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="快捷键"
        description="媒体库和播放器快捷键会避开输入框"
        className="w-[min(520px,calc(100vw-40px))]"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {GROUPS.map(group => (
            <div key={group.title}>
              <div className="ui-field-label mb-2">{group.title}</div>
              <div className="space-y-1.5">
                {group.items.map(([key, label]) => (
                  <div key={`${group.title}-${key}`} className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-[color:var(--muted)]">{label}</span>
                    <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface-2)] px-1.5 py-0.5 font-mono text-[9px] text-[color:var(--foreground)]">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
