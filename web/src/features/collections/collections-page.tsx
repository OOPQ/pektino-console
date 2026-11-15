import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  Eye,
  Heart,
  Layers,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppState } from '@/features/use-app-state'
import { useLibraryActions } from '@/features/library/use-library-actions'
import { confirmAction } from '@/store/confirm'
import { useUiStore } from '@/store/ui'
import { post } from '@/lib/api'
import { cn, formatCount, formatDate, rowTitle } from '@/lib/utils'
import type { DownloadItem, Row } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardBody, CardFooter, CardMedia } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Stars } from '@/components/stars'
import { StatusBadge } from '@/components/status-badge'
import { CoverImage } from '@/components/cover-image'
import { PreviewDialog } from '@/features/library/preview-dialog'
import { LibraryGallery } from '@/features/library/library-gallery'
import type { RowMenuActions } from '@/features/library/row-context-menu'

type Collection = {
  id: number
  name: string
  color: string
  count: number
  createdAt?: string
  updatedAt?: string
}

const COLORS = ['#4f8cff', '#f2a33c', '#f06292', '#54c08a', '#9b7bff', '#ef5350', '#5bc0de', '#d4b106']

const COLLECTION_STATUS = [
  { value: 'all', label: '全部状态' },
  { value: 'new', label: '待下载' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '下载失败' },
]

export function CollectionsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const actions = useLibraryActions()
  const { data: state } = useAppState()
  const downloadMap = React.useMemo(() => new Map<string, DownloadItem>((state?.download?.items || []).map(item => [item.token, item])), [state?.download?.items])
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('all')
  const [newName, setNewName] = React.useState('')
  const [newColor, setNewColor] = React.useState(COLORS[0])
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editColor, setEditColor] = React.useState(COLORS[0])
  const [busy, setBusy] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const multi = useUiStore(s => s.multi)
  const setMulti = useUiStore(s => s.setMulti)

  const openPreview = useUiStore(s => s.openPreview)
  const previewToken = useUiStore(s => s.previewToken)
  const previewAutoplay = useUiStore(s => s.previewAutoplay)
  const closePreview = useUiStore(s => s.closePreview)

  const collectionsQuery = useQuery<{ items: Collection[] }>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await fetch('/api/collections', { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集失败')
      return res.json()
    },
    staleTime: 5_000,
  })

  const collections = collectionsQuery.data?.items || []
  const current = collections.find(c => c.id === selectedId) || collections[0] || null

  React.useEffect(() => {
    if (!selectedId && collections.length) setSelectedId(collections[0].id)
  }, [collections, selectedId])

  React.useEffect(() => {
    setSelected([])
  }, [selectedId])

  React.useEffect(() => {
    if (!multi) setSelected([])
  }, [multi])

  const itemsQuery = useQuery<{ ok: boolean; id: number; tokens: string[] }>({
    queryKey: ['collection-items', current?.id],
    queryFn: async () => {
      const res = await fetch(`/api/collections/items?id=${current!.id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集条目失败')
      return res.json()
    },
    enabled: !!current?.id,
    staleTime: 3_000,
  })

  const rowMap = React.useMemo(() => new Map((state?.rows || []).map(r => [r.token, r])), [state?.rows])
  const rows = React.useMemo(() => {
    const tokens = itemsQuery.data?.tokens || []
    const list = tokens.map(t => rowMap.get(t)).filter(Boolean) as Row[]
    const q = query.trim().toLowerCase()
    return list.filter(row => {
      if (status !== 'all' && row.status !== status) return false
      if (!q) return true
      return [row.token, row.title, row.source, row.res].join(' ').toLowerCase().includes(q)
    })
  }, [itemsQuery.data?.tokens, rowMap, query, status])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['collections'] })
    qc.invalidateQueries({ queryKey: ['collection-items'] })
    qc.invalidateQueries({ queryKey: ['state'] })
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const r = await post<{ ok: boolean; id?: number; error?: string }>('/api/collections', { action: 'create', name, color: newColor })
      if (!r.ok || !r.id) throw new Error(r.error || '新建失败')
      setNewName('')
      setSelectedId(r.id)
      toast.success('合集已创建')
      invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openEditor = () => {
    if (!current) return
    setEditName(current.name)
    setEditColor(current.color || COLORS[0])
    setEditorOpen(true)
  }

  const saveEditor = async () => {
    if (!current) return
    const name = editName.trim()
    if (!name) return toast.error('合集名称不能为空')
    setBusy(true)
    try {
      if (name !== current.name) {
        const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'rename', id: current.id, name })
        if (!r.ok) throw new Error(r.error || '重命名失败')
      }
      if (editColor !== current.color) {
        const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'color', id: current.id, color: editColor })
        if (!r.ok) throw new Error(r.error || '改颜色失败')
      }
      toast.success('合集已更新')
      setEditorOpen(false)
      invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteCollection = async () => {
    if (!current) return
    if (!(await confirmAction({ title: '删除合集', description: `删除「${current.name}」？条目本身不会被删除。`, confirmText: '删除合集', danger: true }))) return
    setBusy(true)
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'delete', id: current.id })
      if (!r.ok) throw new Error(r.error || '删除失败')
      toast.success('合集已删除')
      setEditorOpen(false)
      setSelectedId(null)
      invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (row: Row) => {
    if (!current) return
    if (!(await confirmAction({ title: '移出合集', description: `把「${rowTitle(row)}」移出「${current.name}」？`, confirmText: '移出' }))) return
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'remove', id: current.id, tokens: [row.token] })
      if (!r.ok) throw new Error(r.error || '移出失败')
      toast.success('已移出合集')
      invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const removeSelected = async () => {
    if (!current || !selected.length) return
    if (!(await confirmAction({ title: '移出合集', description: `把已选 ${selected.length} 条移出「${current.name}」？`, confirmText: '移出', danger: true }))) return
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'remove', id: current.id, tokens: selected })
      if (!r.ok) throw new Error(r.error || '移出失败')
      toast.success(`已移出 ${selected.length} 条`)
      setSelected([])
      invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const copy = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.page_url || row.url)
      toast.success('链接已复制')
    } catch (e) {
      toast.error('复制失败')
    }
  }

  const menu: RowMenuActions = {
    open: openPreview,
    download: row => { void actions.download([row.token]) },
    fav: row => { void actions.fav([row.token], row.fav !== '1') },
    collection: row => { void row; toast.info('在台账中右键加入其他合集') },
    watched: row => { void actions.watched([row.token], !row.last_play) },
    rate: (row, value) => { void actions.rate([row.token], value) },
    recycle: row => { void actions.recycle([row.token]) },
    copy: row => { void copy(row) },
    reveal: row => { void actions.reveal(row.token) },
    markDone: row => { void actions.mark([row.token], 'done') },
    removeFromCollection: row => { void removeItem(row) },
  }

  const openCollectionInLibrary = () => {
    if (current) navigate(`/?collection=${current.id}`)
  }

  if (collectionsQuery.isLoading) return <CollectionsSkeleton />

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-[color:var(--border)] text-[color:var(--primary-2)]"><Layers className="size-4" /></span>
          <div>
            <div className="text-[11.5px] font-medium">{collections.length} 个合集</div>
            <div className="text-[9.5px] text-[color:var(--subtle)]">把条目分组，方便按主题浏览</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={!current} onClick={openEditor}><Pencil className="size-3.5" /> 编辑合集</Button>
          <Button size="sm" variant="ghost" disabled={!current} onClick={openCollectionInLibrary}><Eye className="size-3.5" /> 在台账中查看</Button>
        </div>
      </div>

      <Tabs value={current ? String(current.id) : ''} onValueChange={v => setSelectedId(Number(v))}>
        <TabsList className="max-w-full overflow-x-auto">
          {collections.map(col => (
            <TabsTrigger key={col.id} value={String(col.id)} className="shrink-0">
              <span className="size-2 rounded-full" style={{ background: col.color || COLORS[0] }} />
              {col.name}
              <span className="rounded-full border border-[color:var(--border)] px-1.5 text-[8.5px] text-[color:var(--subtle)]">{col.count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新合集名称" className="w-[170px]" onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`颜色 ${c}`}
              onClick={() => setNewColor(c)}
              className={cn('size-4 rounded-full border-2', newColor === c ? 'border-white' : 'border-transparent')}
              style={{ background: c }}
            />
          ))}
        </div>
        <Button size="sm" onClick={create} disabled={!newName.trim() || busy}><Plus className="size-3.5" /> 新建</Button>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--subtle)]" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="过滤 token / 标题" className="pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus} options={COLLECTION_STATUS} className="w-[116px]" aria-label="合集状态筛选" />
        <Button size="sm" variant={multi ? 'outline' : 'ghost'} onClick={() => setMulti(!multi)}><ListChecks className="size-3.5" /> 多选</Button>
        <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setStatus('all') }} disabled={!query && status === 'all'}><RotateCcw className="size-3.5" /> 重置</Button>
      </div>

      {current ? (
        <div className="flex items-center justify-between gap-2 text-[10px] text-[color:var(--subtle)]">
          <span><b className="text-[color:var(--foreground)]">{rows.length}</b> 条 · {current.name}</span>
          {selected.length ? (
            <span className="flex items-center gap-2">
              已选 {selected.length}
              <Button size="sm" variant="outline" className="h-7" onClick={removeSelected}>移出当前合集</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected([])}>清空</Button>
            </span>
          ) : null}
        </div>
      ) : null}

      {!current ? (
        <div className="grid min-h-[280px] place-items-center rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="text-center">
            <Layers className="mx-auto size-6 text-[color:var(--subtle)]" />
            <div className="mt-2 text-[12px] font-medium">还没有合集</div>
            <div className="mt-1 text-[10px] text-[color:var(--subtle)]">先在上方创建，再从台账加入条目。</div>
          </div>
        </div>
      ) : (
        <>
        <LibraryGallery
          downloads={downloadMap}
          rows={rows}
          selected={selected}
          onToggle={token => setSelected(s => s.includes(token) ? s.filter(t => t !== token) : [...s, token])}
          onOpen={openPreview}
          onFav={row => { void actions.fav([row.token], row.fav !== '1') }}
          onRate={(row, value) => { void actions.rate([row.token], value) }}
          onDownload={row => { void actions.download([row.token]) }}
          menu={menu}
        />
        {!rows.length ? (
          <div className="grid min-h-[220px] place-items-center rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
            <div className="text-center">
              <div className="text-[12px] font-medium">这个合集还没有条目</div>
              <div className="mt-1 text-[10px] text-[color:var(--subtle)]">在台账选择条目 → 加入合集，或从顶部选择其他合集。</div>
            </div>
          </div>
        ) : null}
        </>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent
          title="编辑合集"
          className="w-[min(440px,calc(100vw-40px))]"
          footer={
            <div className="flex w-full items-center gap-2">
              <Button size="sm" variant="danger" onClick={deleteCollection} disabled={busy}>删除合集</Button>
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => setEditorOpen(false)}>取消</Button>
              <Button size="sm" onClick={saveEditor} disabled={busy || !editName.trim()}>保存</Button>
            </div>
          }
        >
          <div className="space-y-3 p-4">
            <div>
              <div className="ui-field-label mb-1.5">名称</div>
              <Input value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <div className="ui-field-label mb-1.5">颜色</div>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`颜色 ${c}`}
                    onClick={() => setEditColor(c)}
                    className={cn('size-6 rounded-full border-2', editColor === c ? 'border-white' : 'border-transparent')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2">
              <span className="size-2.5 rounded-full" style={{ background: editColor }} />
              <span className="truncate text-[11px] text-[color:var(--muted)]">{editName || '合集名称'}</span>
              <Badge className="ml-auto" tone="default">{current?.count || 0} 条</Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PreviewDialog
        rows={rows}
        token={previewToken}
        downloadItem={previewToken ? downloadMap.get(previewToken) : undefined}
        autoplay={previewAutoplay}
        media={state?.media}
        onClose={closePreview}
        onNavigate={openPreview}
        onFav={row => actions.fav([row.token], row.fav !== '1')}
      />
    </div>
  )
}

function CollectionsSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-[62px] rounded-[14px]" />
      <Skeleton className="h-8 w-[320px]" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-[14px]" />)}
      </div>
    </div>
  )
}
