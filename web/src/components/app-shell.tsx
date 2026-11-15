import * as React from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  CircleHelp,
  Download,
  Layers,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  RefreshCw,
  Settings,
  Sun,
  Moon,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppState } from '@/features/use-app-state'
import { useUiStore } from '@/store/ui'
import { playDownloadChime } from '@/lib/sound'
import { cn, formatCount } from '@/lib/utils'
import { toast } from 'sonner'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { ShortcutHelp } from '@/components/shortcut-help'
import { CommandPalette } from '@/components/command-palette'

const NAV = [
  { to: '/', label: '媒体库', icon: Library, key: 'library' },
  { to: '/queue', label: '下载队列', icon: Download, key: 'queue' },
  { to: '/collections', label: '合集', icon: Layers, key: 'collections' },
  { to: '/bin', label: '回收站', icon: Trash2, key: 'bin' },
  { to: '/settings', label: '设置', icon: Settings, key: 'settings' },
] as const

const PAGE_META: Record<string, { kicker: string; title: string }> = {
  '/': { kicker: 'LIBRARY', title: '媒体库' },
  '/queue': { kicker: 'QUEUE', title: '下载队列' },
  '/collections': { kicker: 'COLLECTIONS', title: '合集' },
  '/bin': { kicker: 'RECYCLE', title: '回收站' },
  '/settings': { kicker: 'SETTINGS', title: '设置' },
}

function usePageMeta() {
  const { pathname } = useLocation()
  return PAGE_META[pathname] || { kicker: 'PEKTINO', title: '媒体库' }
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-[38px] items-center gap-2.5 px-1', collapsed && 'justify-center px-0')}>
      <img src="/api/logo" alt="pektino" className="size-[34px] shrink-0 rounded-[10px] object-cover shadow-[0_8px_22px_rgba(47,111,228,.35)]" />
      {!collapsed ? (
        <div className="min-w-0">
          <b className="block text-[13px] leading-tight tracking-[.2px]">pektino</b>
          <small className="block text-[9px] tracking-[.5px] text-[color:var(--subtle)]">本地媒体台账</small>
        </div>
      ) : null}
    </div>
  )
}

function Sidebar() {
  const collapsed = useUiStore(s => s.sidebarCollapsed)
  const theme = useUiStore(s => s.theme)
  const setTheme = useUiStore(s => s.setTheme)
  const { data } = useAppState()
  const navigate = useNavigate()
  const stats = data?.stats

  const counts: Record<string, number> = {
    queue: stats?.new || 0,
    collections: 0,
    bin: stats?.recycled || 0,
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[color:var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_72%,transparent),var(--background-2))] px-2.5 py-4 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-[216px]',
      )}
    >
      <Brand collapsed={collapsed} />

      <div className={cn('mt-4 px-2 text-[9px] tracking-[.9px] text-[color:var(--subtle)]', collapsed && 'hidden')}>浏览</div>
      <nav className="mt-1 flex flex-col gap-0.5" aria-label="主菜单">
        {NAV.slice(0, 3).map(item => (
          <SideLink key={item.key} item={item} collapsed={collapsed} count={counts[item.key]} />
        ))}
      </nav>

      <div className={cn('mt-4 px-2 text-[9px] tracking-[.9px] text-[color:var(--subtle)]', collapsed && 'hidden')}>管理</div>
      <nav className="mt-1 flex flex-col gap-0.5" aria-label="管理菜单">
        {NAV.slice(3).map(item => (
          <SideLink key={item.key} item={item} collapsed={collapsed} count={counts[item.key]} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-[color:var(--border)] pt-3">
        <div className={cn('flex items-center gap-2 px-1', collapsed && 'justify-center')}>
          <span className={cn('size-1.5 shrink-0 rounded-full', data?.ok ? 'bg-[color:var(--success)]' : 'bg-[color:var(--danger)]')} />
          {!collapsed ? (
            <span className="min-w-0 truncate text-[9.5px] text-[color:var(--subtle)]">
              {data?.ok ? `在线 · ${formatCount(stats?.total || 0)} 条` : '连接中…'}
            </span>
          ) : null}
        </div>
        <div className={cn('flex items-center gap-2 px-1', collapsed && 'justify-center')}>
          {!collapsed ? <span className="text-[9.5px] text-[color:var(--subtle)]">主题</span> : null}
          <div className="flex items-center gap-0.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-0.5">
            <button type="button" aria-label="亮色主题" title="亮色" onClick={() => setTheme('light')} className={cn('grid size-6 place-items-center rounded-md transition-colors', theme === 'light' ? 'bg-[color:var(--surface-3)] text-[color:var(--foreground)]' : 'text-[color:var(--subtle)] hover:text-[color:var(--foreground)]')}>
              <Sun className="size-3.5" />
            </button>
            <button type="button" aria-label="暗色主题" title="暗色" onClick={() => setTheme('dark')} className={cn('grid size-6 place-items-center rounded-md transition-colors', theme === 'dark' ? 'bg-[color:var(--surface-3)] text-[color:var(--foreground)]' : 'text-[color:var(--subtle)] hover:text-[color:var(--foreground)]')}>
              <Moon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function SideLink({
  item,
  collapsed,
  count,
}: {
  item: (typeof NAV)[number]
  collapsed: boolean
  count?: number
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-[34px] items-center gap-2.5 rounded-lg border px-2.5 text-[11.5px] transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'border-[color:color-mix(in_srgb,var(--primary)_25%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_9%,transparent)] text-[color:var(--foreground)]'
            : 'border-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--foreground)]',
        )
      }
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
      {!collapsed && count ? (
        <span className="ml-auto rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-1.5 text-[9px] leading-[15px] text-[color:var(--subtle)]">
          {formatCount(count)}
        </span>
      ) : null}
      {collapsed && count ? (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[color:var(--primary)]" />
      ) : null}
    </NavLink>
  )
}

function Topbar({ onHelp, onCommand }: { onHelp: () => void; onCommand: () => void }) {
  const collapsed = useUiStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUiStore(s => s.toggleSidebar)
  const { kicker, title } = usePageMeta()
  const { data, isFetching } = useAppState()
  const qc = useQueryClient()
  const navigate = useNavigate()

  return (
    <header className="flex h-[58px] shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border)] px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton label={collapsed ? '展开主菜单' : '收起主菜单'} size="sm" onClick={toggleSidebar} className="border-transparent bg-transparent">
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </IconButton>
        <div className="min-w-0">
          <div className="truncate text-[9px] tracking-[.9px] text-[color:var(--subtle)]">{kicker}</div>
          <h1 className="truncate text-[18px] font-semibold leading-tight tracking-[-.3px]">{title}</h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-1 text-[9.5px] text-[color:var(--subtle)] sm:flex">
          <span className={cn('size-1.5 rounded-full', data?.ok ? 'bg-[color:var(--success)]' : 'bg-[color:var(--danger)]')} />
          {data?.ok ? '在线' : '离线'}
        </span>
        <IconButton
          label={isFetching ? '刷新中' : '刷新'}
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ['state'] })}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
        </IconButton>
        <IconButton label="命令面板" size="sm" onClick={onCommand}>
          <Search className="size-4" />
        </IconButton>
        <IconButton label="快捷键" size="sm" onClick={onHelp}>
          <CircleHelp className="size-4" />
        </IconButton>
        <IconButton label="设置" size="sm" onClick={() => navigate('/settings')}>
          <Settings className="size-4" />
        </IconButton>
      </div>
    </header>
  )
}

export function AppShell() {
  const theme = useUiStore(s => s.theme)
  const setTheme = useUiStore(s => s.setTheme)
  const { data } = useAppState()
  const navigate = useNavigate()
  const wasRunning = React.useRef(false)
  const lastResult = React.useRef('')
  const downloadWasRunning = React.useRef(false)
  const lastDownloadResult = React.useRef('')

  React.useEffect(() => {
    const d = data?.download
    if (!d) return
    if (d.running) {
      downloadWasRunning.current = true
      return
    }
    if (!downloadWasRunning.current) return
    downloadWasRunning.current = false
    const key = `${d.phase || ''}|${d.done || 0}|${d.failed || 0}|${d.bytes || 0}`
    if (key === lastDownloadResult.current) return
    lastDownloadResult.current = key
    const items = d.items || []
    const current = items.filter(item => !item.history)
    const done = current.filter(item => item.state === 'done').length
    const failed = current.filter(item => item.state === 'failed' || item.state === 'dead').length
    if (d.phase === 'error') {
      toast.error('下载失败', {
        description: d.errors?.[0]?.error || '下载进程异常结束',
        duration: 8000,
        action: { label: '查看队列', onClick: () => navigate('/queue') },
      })
      return
    }
    playDownloadChime()
    toast.success(failed > 0 ? '下载结束' : '下载完成', {
      description: `${done || d.done || 0} 完成${failed ? ` · ${failed} 失败` : ''}`,
      duration: 7000,
      action: { label: '查看队列', onClick: () => navigate('/queue') },
    })
  }, [data?.download, data?.download?.running, data?.download?.done, data?.download?.failed, data?.download?.phase, data?.download?.items])
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(true)
        return
      }
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable]')) return
      e.preventDefault()
      setHelpOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    setTheme(theme)
  }, [theme, setTheme])

  React.useEffect(() => {
    const job = data?.job
    if (!job) return
    if (job.running) { wasRunning.current = true; return }
    let pending = false
    try { pending = sessionStorage.getItem('pektino.scrapePending') === '1' } catch { }
    let pendingAt = 0
    try { pendingAt = Number(sessionStorage.getItem('pektino.scrapePendingAt') || 0) } catch { }
    if (!wasRunning.current && !pending) return
    const p = job.progress
    if (!p || (p.phase !== 'done' && p.phase !== 'failed')) return
    const key = `${p.at || ''}|${p.phase}|${p.added || 0}|${p.updated || 0}|${p.count || 0}`
    if (key === lastResult.current) return
    if (pending && p.finishedAt && pendingAt && p.finishedAt < pendingAt - 3000) return
    lastResult.current = key
    wasRunning.current = false
    try { sessionStorage.removeItem('pektino.scrapePending'); sessionStorage.removeItem('pektino.scrapePendingAt') } catch { }
    if (p.phase === 'failed') {
      toast.error('抓取失败', { description: p.error || '任务没有正常完成', duration: 7000 })
      return
    }
    const title = p.kind === 'import' ? '导入完成' : '抓取完成'
    const addedTokens = (p.addedTokens || []).filter(Boolean)
    if (addedTokens.length) {
      try { sessionStorage.setItem('pektino.batchTokens', JSON.stringify(addedTokens)); sessionStorage.setItem('pektino.batchAt', p.at || '') } catch { }
    }
    toast.success(`${title}：新增 ${p.added || 0}，更新 ${p.updated || 0}`, {
      description: p.count ? `本轮共处理 ${p.count} 条` : undefined,
      duration: 7000,
      action: addedTokens.length ? { label: '查看新增', onClick: () => navigate('/?batch=1') } : undefined,
    })
  }, [data?.job, data?.job?.running, data?.job?.progress?.phase, data?.job?.progress?.at])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onHelp={() => setHelpOpen(true)} onCommand={() => setCommandOpen(true)} />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6">
      <div className="rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)] p-8">
        <div className="text-[9px] tracking-[1px] text-[color:var(--subtle)]">NEXT SLICE</div>
        <h2 className="mt-1 text-[18px] font-semibold">{title}</h2>
        <p className="mt-2 max-w-[520px] text-[12px] leading-6 text-[color:var(--muted)]">{description}</p>
        <Button className="mt-4" variant="outline" onClick={() => history.back()}>返回</Button>
      </div>
    </div>
  )
}
