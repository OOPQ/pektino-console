import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Layers, Library, Moon, RefreshCw, Search, Settings, Sun, Trash2 } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

type Item = {
  key: string
  label: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  run: () => void
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const theme = useUiStore(s => s.theme)
  const setTheme = useUiStore(s => s.setTheme)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  const items: Item[] = [
    { key: 'library', label: '媒体库', hint: '台账 / 画廊', icon: Library, run: () => go('/') },
    { key: 'queue', label: '下载队列', hint: '进度 / 历史', icon: Download, run: () => go('/queue') },
    { key: 'collections', label: '合集', hint: '分组浏览', icon: Layers, run: () => go('/collections') },
    { key: 'bin', label: '回收站', hint: '恢复 / 彻底删除', icon: Trash2, run: () => go('/bin') },
    { key: 'settings', label: '设置', hint: '路径 / 代理 / 界面', icon: Settings, run: () => go('/settings') },
    {
      key: 'refresh',
      label: '刷新当前数据',
      hint: '重新拉取台账',
      icon: RefreshCw,
      run: () => { qc.invalidateQueries({ queryKey: ['state'] }); onOpenChange(false) },
    },
    {
      key: 'theme',
      label: theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题',
      hint: '外观',
      icon: theme === 'dark' ? Sun : Moon,
      run: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); onOpenChange(false) },
    },
  ]

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? items.filter(item => `${item.label} ${item.hint || ''}`.toLowerCase().includes(needle))
    : items

  const runFirst = () => {
    const first = filtered[0]
    if (first) first.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="命令面板" description="输入页面或操作，Enter 执行第一项" className="w-[min(560px,calc(100vw-40px))]">
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--subtle)]" />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runFirst() } }}
              placeholder="搜索页面或操作…"
              className="pl-8"
            />
          </div>
          <div className="mt-2 max-h-[340px] space-y-0.5 overflow-auto">
            {filtered.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.run}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-3)] hover:text-[color:var(--foreground)]',
                  )}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? <span className="shrink-0 text-[9px] text-[color:var(--subtle)]">{item.hint}</span> : null}
                </button>
              )
            })}
            {!filtered.length ? <div className="px-2 py-8 text-center text-[10px] text-[color:var(--subtle)]">没有匹配项</div> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
