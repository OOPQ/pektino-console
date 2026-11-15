import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppState } from '@/features/use-app-state'
import { useLibraryActions } from '@/features/library/use-library-actions'
import { confirmAction } from '@/store/confirm'
import { useUiStore } from '@/store/ui'
import { post } from '@/lib/api'
import { unlockAudio } from '@/lib/sound'
import { cn, formatBytes, formatCount, rowTitle } from '@/lib/utils'
import type { Row } from '@/types'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Card } from '@/components/ui/card'
import { CoverImage } from '@/components/cover-image'
import { StatusBadge } from '@/components/status-badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PreviewDialog } from '@/features/library/preview-dialog'

type Tab = 'active' | 'done' | 'failed' | 'cancelled'
type DItem = { token: string; state: string; bytes: number; error?: string; history?: boolean; addedAt?: string }

const ACTIVE = new Set(['downloading', 'queued', 'paused'])

export function QueuePage() {
  const { data, isLoading, isFetching, refetch } = useAppState(3_000)
  const qc = useQueryClient()
  const actions = useLibraryActions()
  const [tab, setTab] = React.useState<Tab>('active')
  const openPreview = useUiStore(s => s.openPreview)
  const userPicked = React.useRef(false)
  const previewToken = useUiStore(s => s.previewToken)
  const previewAutoplay = useUiStore(s => s.previewAutoplay)
  const closePreview = useUiStore(s => s.closePreview)

  const download = data?.download
  const items: DItem[] = React.useMemo(() => download?.items || [], [download?.items])
  const rowMap = React.useMemo(() => new Map((data?.rows || []).map(r => [r.token, r])), [data?.rows])

  const groups = React.useMemo(() => ({
    active: items.filter(i => ACTIVE.has(i.state)),
    done: items.filter(i => i.state === 'done'),
    failed: items.filter(i => i.state === 'failed' || i.state === 'dead'),
    cancelled: items.filter(i => i.state === 'cancelled'),
  }), [items])

  React.useEffect(() => {
    if (isLoading || userPicked.current) return
    if (groups.active.length) setTab('active')
    else if (groups.done.length) setTab('done')
  }, [isLoading, groups.active.length, groups.done.length])
  const list = groups[tab]
  const queueGroups = React.useMemo(() => {
    const map = new Map<string, DItem[]>()
    const ordered = [...list].sort((a, b) => {
      const at = (x: DItem) => x.addedAt || rowMap.get(x.token)?.first_seen || ''
      return at(b).localeCompare(at(a))
    })
    for (const item of ordered) {
      const row = rowMap.get(item.token)
      const raw = item.addedAt || row?.first_seen || row?.last_seen || ''
      const date = raw.slice(0, 10) || '未知日期'
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(item)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [list, rowMap])
  const failedTokens = groups.failed.map(i => i.token)
  const concurrency = data?.settings?.concurrent || 3

  const after = () => {
    qc.invalidateQueries({ queryKey: ['state'] })
  }

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      toast.success(message)
      after()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const pauseAll = () => run(() => post('/api/download/pause', { on: true }), '已暂停全部下载')
  const resumeAll = () => run(() => post('/api/download/pause', { on: false }), '已继续全部下载')
  const cancelAll = async () => {
    if (await confirmAction({ title: '取消全部下载', description: '正在下载和排队的条目都会被取消，已下载的 .part 会保留。', confirmText: '全部取消', danger: true })) {
      run(() => post('/api/download/cancel', {}), '已取消全部下载')
    }
  }
  const clearDone = async () => {
    if (await confirmAction({ title: '清理已完成记录', description: '只清理队列历史，不删除文件，也不改台账。', confirmText: '清理' })) {
      run(() => post('/api/download/clear-done', {}), '已清理完成记录')
    }
  }
  const retryFailed = () => { unlockAudio(); run(() => post('/api/download', { tokens: failedTokens, status: 'failed' }), '已重新加入失败条目') }
  const setConcurrent = (value: string) => run(() => post('/api/config', { concurrent: Number(value) }), `并发数已设为 ${value}`)

  const pauseItem = (token: string) => run(() => post('/api/download/pause', { on: true, tokens: [token] }), '已暂停')
  const resumeItem = (token: string) => run(() => post('/api/download/pause', { on: false, tokens: [token] }), '已继续')
  const cancelItem = async (token: string) => {
    if (await confirmAction({ title: '取消这一条', description: '取消后已下载的 .part 会保留，可再次下载。', confirmText: '取消下载', danger: true })) {
      run(() => post('/api/download/cancel', { tokens: [token] }), '已取消')
    }
  }

  const open = (row: Row | undefined, token: string) => {
    openPreview(token, Boolean(row?.file_name))
  }

  if (isLoading) return <QueueSkeleton />

  const activeCount = groups.active.length
  const paused = download?.paused || false

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('grid size-8 place-items-center rounded-lg border', download?.running ? 'border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_10%,transparent)] text-[color:var(--primary-2)]' : 'border-[color:var(--border)] text-[color:var(--subtle)]')}>
            {download?.running ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          </span>
          <div>
            <div className="text-[11.5px] font-medium">{download?.running ? (paused ? '已暂停' : `下载中 · ${download.phase || ''}`) : '队列空闲'}</div>
            <div className="text-[9.5px] text-[color:var(--subtle)]">
              {download?.done || 0}/{download?.total || 0} 完成
              {download?.failed ? ` · ${download.failed} 失败` : ''}
              {download?.speed ? ` · ${download.speed.toFixed(2)} MB/s` : ''}
            </div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={!activeCount || paused} onClick={pauseAll}><Pause className="size-3.5" /> 全部暂停</Button>
          <Button size="sm" variant="outline" disabled={!paused} onClick={resumeAll}><Play className="size-3.5" /> 继续</Button>
          <Button size="sm" variant="ghost" disabled={!activeCount} onClick={cancelAll}><Ban className="size-3.5" /> 全部取消</Button>
          <Button size="sm" variant="ghost" disabled={!groups.done.length} onClick={clearDone}><Trash2 className="size-3.5" /> 清理已完成</Button>
          <Button size="sm" variant="ghost" disabled={!failedTokens.length} onClick={retryFailed}><RotateCcw className="size-3.5" /> 重试失败</Button>
          <span className="ml-1 text-[9.5px] text-[color:var(--subtle)]">并发</span>
          <Select
            value={String(concurrency)}
            onValueChange={setConcurrent}
            options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            className="h-8 w-[64px]"
            aria-label="并发下载数"
          />
          <IconButton label="刷新" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={v => { userPicked.current = true; setTab(v as Tab) }}>
          <TabsList>
            <TabsTrigger value="active">进行中 <span className="rounded-full border border-[color:var(--border)] px-1.5 text-[8.5px]">{groups.active.length}</span></TabsTrigger>
            <TabsTrigger value="done">已完成 <span className="rounded-full border border-[color:var(--border)] px-1.5 text-[8.5px]">{groups.done.length}</span></TabsTrigger>
            <TabsTrigger value="failed">失败 <span className="rounded-full border border-[color:var(--border)] px-1.5 text-[8.5px]">{groups.failed.length}</span></TabsTrigger>
            <TabsTrigger value="cancelled">已取消 <span className="rounded-full border border-[color:var(--border)] px-1.5 text-[8.5px]">{groups.cancelled.length}</span></TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[9.5px] text-[color:var(--subtle)]">
          共 {formatCount(download?.total || 0)} 条 · 累计 {formatBytes(download?.bytes || 0)}
        </span>
      </div>

      <div className="space-y-2">
        {!list.length ? (
          <div className="grid min-h-[240px] place-items-center rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
            <div className="text-center">
              <div className="mx-auto grid size-10 place-items-center rounded-full border border-[color:var(--border)] text-[color:var(--subtle)]">
                {tab === 'active' ? <Download className="size-4" /> : tab === 'failed' ? <Ban className="size-4" /> : <Check className="size-4" />}
              </div>
              <div className="mt-2 text-[12px] font-medium">{tab === 'active' ? '没有进行中的下载' : tab === 'failed' ? '没有失败条目' : tab === 'done' ? '还没有完成记录' : '没有已取消条目'}</div>
              <div className="mt-1 text-[10px] text-[color:var(--subtle)]">从台账选择条目下载后，进度会出现在这里。</div>
            </div>
          </div>
        ) : null}

        {queueGroups.map(([date, groupItems]) => (
          <details key={date} open className="group overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10.5px] text-[color:var(--muted)] [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-3.5 -rotate-90 text-[color:var(--subtle)] transition-transform group-open:rotate-0" />
              <span className="font-medium text-[color:var(--foreground)]">{date}</span>
              <span className="text-[color:var(--subtle)]">{groupItems.length} 条</span>
              <span className="ml-auto text-[9.5px] text-[color:var(--subtle)]">{formatBytes(groupItems.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0))}</span>
            </summary>
            <div className="space-y-2 border-t border-[color:var(--border)] p-2.5">
        {groupItems.map(item => {
          const row = rowMap.get(item.token)
          const expected = Number(row?.file_size) || 0
          const pct = item.state === 'done' ? 100 : expected ? Math.min(99, Math.round((item.bytes / expected) * 100)) : 0
          const canPause = item.state === 'downloading' || item.state === 'queued'
          const canResume = item.state === 'paused'
          const canCancel = ACTIVE.has(item.state)
          return (
            <Card key={item.token} className="flex items-center gap-2.5 p-2.5">
              <button
                type="button"
                onClick={() => open(row, item.token)}
                className="relative block shrink-0 overflow-hidden rounded-lg"
                aria-label="打开预览"
              >
                <CoverImage token={item.token} className="h-[72px] w-[54px]" alt={row ? rowTitle(row) : item.token} />
                {row?.file_name ? (
                  <span className="absolute inset-x-0 bottom-0 grid h-5 place-items-center bg-black/55 text-white backdrop-blur">
                    <Play className="size-3 fill-current" />
                  </span>
                ) : null}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-[11.5px] font-medium">{row ? rowTitle(row) : item.token}</div>
                  <StatusBadge status={item.state} />
                  {item.state === 'downloading' ? <span className="text-[9px] text-[color:var(--primary-2)]">{download?.speed ? `${download.speed.toFixed(2)} MB/s` : '下载中'}</span> : null}
                </div>
                <div className="mt-0.5 truncate text-[9.5px] text-[color:var(--subtle)]">
                  <span className="ui-mono">{item.token}</span>
                  {row?.res ? <span> · {row.res}</span> : null}
                  {item.error ? <span className="text-[color:var(--danger)]"> · {item.error}</span> : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Progress
                    value={pct}
                    tone={item.state === 'failed' || item.state === 'dead' ? 'danger' : item.state === 'done' ? 'success' : item.state === 'paused' ? 'warning' : 'primary'}
                    className="flex-1"
                  />
                  <span className="w-20 shrink-0 text-right text-[9px] text-[color:var(--subtle)]">
                    {formatBytes(item.bytes)}{expected ? ` / ${formatBytes(expected)}` : ''}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {canPause ? <IconButton label="暂停" size="sm" onClick={() => pauseItem(item.token)}><Pause className="size-3.5" /></IconButton> : null}
                {canResume ? <IconButton label="继续" size="sm" onClick={() => resumeItem(item.token)}><Play className="size-3.5" /></IconButton> : null}
                {canCancel ? <IconButton label="取消" size="sm" tone="danger" onClick={() => cancelItem(item.token)}><Ban className="size-3.5" /></IconButton> : null}
                <IconButton label="定位文件" size="sm" disabled={!row?.file_name} onClick={() => row && actions.reveal(row.token)}>
                  <FolderOpen className="size-3.5" />
                </IconButton>
              </div>
            </Card>
          )
        })}
            </div>
          </details>
        ))}
      </div>

      <PreviewDialog
        rows={data?.rows || []}
        token={previewToken}
        downloadItem={previewToken ? items.find(i => i.token === previewToken) : undefined}
        autoplay={previewAutoplay}
        media={data?.media}
        onClose={closePreview}
        onNavigate={openPreview}
        onFav={row => actions.fav([row.token], row.fav !== '1')}
      />
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-[70px] rounded-[14px]" />
      <Skeleton className="h-8 w-[360px]" />
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}
    </div>
  )
}
