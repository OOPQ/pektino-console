import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAppState } from '@/features/use-app-state'
import { confirmAction } from '@/store/confirm'
import { post } from '@/lib/api'
import { formatBytes, formatDate, rowTitle } from '@/lib/utils'
import type { Row } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { IconButton } from '@/components/ui/icon-button'
import { Card } from '@/components/ui/card'
import { CoverImage } from '@/components/cover-image'
import { StatusBadge } from '@/components/status-badge'

export function BinPage() {
  const qc = useQueryClient()
  const { data, isLoading, refetch, isFetching } = useAppState(8_000)
  const [query, setQuery] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  const rows = (data?.rows || []).filter(r => r.status === 'recycled')
  const visible = rows.filter(r => {
    const q = query.trim().toLowerCase()
    return !q || [r.token, r.title, r.source].join(' ').toLowerCase().includes(q)
  }).sort((a, b) => (b.recycled_at || '').localeCompare(a.recycled_at || ''))
  const totalBytes = rows.reduce((sum, r) => sum + (Number(r.file_size) || 0), 0)
  const groups = React.useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const row of visible) {
      const raw = row.recycled_at || ''
      const date = raw.slice(0, 10) || '历史记录'
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(row)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [visible])

  const after = () => qc.invalidateQueries({ queryKey: ['state'] })

  const restore = async (tokens: string[]) => {
    setBusy(tokens[0] || 'restore')
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/restore', { tokens })
      if (!r.ok) throw new Error(r.error || '恢复失败')
      toast.success(`已恢复 ${tokens.length} 条`)
      after()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const purge = async (tokens: string[], one?: Row) => {
    const label = one ? `「${rowTitle(one)}」` : `${tokens.length} 条`
    if (!(await confirmAction({ title: '彻底删除', description: `彻底删除 ${label}？会同时删除本地文件，无法撤销。`, confirmText: '彻底删除', danger: true }))) return
    setBusy(tokens[0] || 'purge')
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/delete', { tokens, purge: true, permanent: true })
      if (!r.ok) throw new Error(r.error || '删除失败')
      toast.success(`已彻底删除 ${tokens.length} 条`)
      after()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const clearAll = async () => {
    if (!rows.length) return
    if (!(await confirmAction({ title: '清空回收站', description: `彻底删除回收站里的 ${rows.length} 条？会同时删除本地文件，无法撤销。`, confirmText: '清空回收站', danger: true }))) return
    setBusy('all')
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/delete', { tokens: rows.map(r => r.token), purge: true, permanent: true })
      if (!r.ok) throw new Error(r.error || '清空失败')
      toast.success('回收站已清空')
      after()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <BinSkeleton />

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg border border-[color:var(--border)] text-[color:var(--danger)]"><Trash2 className="size-4" /></span>
        <div>
          <div className="text-[11.5px] font-medium">{rows.length} 条在回收站</div>
          <div className="text-[9.5px] text-[color:var(--subtle)]">恢复不会重新下载；彻底删除会删本地文件</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-[9.5px] text-[color:var(--subtle)]">占用 {formatBytes(totalBytes)}</span>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}><RotateCcw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 刷新</Button>
          <Button size="sm" variant="danger" onClick={clearAll} disabled={!rows.length || busy === 'all'}>清空回收站</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--subtle)]" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="过滤 token / 标题 / 来源" className="pl-8" />
        </div>
        <span className="text-[10px] text-[color:var(--subtle)]">共 {visible.length} 条</span>
      </div>

      {!visible.length ? (
        <div className="grid min-h-[260px] place-items-center rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="text-center">
            <Trash2 className="mx-auto size-6 text-[color:var(--subtle)]" />
            <div className="mt-2 text-[12px] font-medium">{rows.length ? '没有匹配的条目' : '回收站是空的'}</div>
            <div className="mt-1 text-[10px] text-[color:var(--subtle)]">{rows.length ? '换个关键词试试。' : '删除的条目会先进入这里，可以恢复。'}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(([date, items]) => (
            <details key={date} className="group overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10.5px] text-[color:var(--muted)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 -rotate-90 text-[color:var(--subtle)] transition-transform group-open:rotate-0" />
                <span className="font-medium text-[color:var(--foreground)]">{date}</span>
                <span className="text-[color:var(--subtle)]">{items.length} 条</span>
                <span className="ml-auto text-[9.5px] text-[color:var(--subtle)]">{formatBytes(items.reduce((sum, r) => sum + (Number(r.file_size) || 0), 0))}</span>
              </summary>
              <div className="space-y-2 border-t border-[color:var(--border)] p-2.5">
                {items.map(row => (
                  <BinRow key={row.token} row={row} busy={busy === row.token} onRestore={() => restore([row.token])} onPurge={() => purge([row.token], row)} />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function BinRow({ row, busy, onRestore, onPurge }: { row: Row; busy: boolean; onRestore: () => void; onPurge: () => void }) {
  return (
    <Card className="flex items-center gap-2.5 p-2.5">
      <CoverImage token={row.token} className="h-[72px] w-[54px] shrink-0 rounded-lg" alt={rowTitle(row)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-[11.5px] font-medium">{rowTitle(row)}</div>
          <StatusBadge status={row.status} />
        </div>
        <div className="mt-0.5 truncate text-[9.5px] text-[color:var(--subtle)]">
          <span className="ui-mono">{row.token}</span>
          {row.source ? <span> · {row.source}</span> : null}
          {row.file_size ? <span> · {formatBytes(row.file_size)}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-[9.5px] text-[color:var(--subtle)]">
          {row.title ? `${row.duration || '—'} · ${row.res || '—'} · ` : ''}
          进入回收站 {row.recycled_at ? formatDate(row.recycled_at) : '历史记录'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" onClick={onRestore} disabled={busy}>
          <Undo2 className="size-3.5" /> 恢复
        </Button>
        <IconButton label="彻底删除" size="sm" tone="danger" onClick={onPurge} disabled={busy}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
    </Card>
  )
}
function BinSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-[62px] rounded-[14px]" />
      <Skeleton className="h-[34px] w-[280px]" />
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}
    </div>
  )
}
