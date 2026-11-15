import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Download,
  FolderCheck,
  FolderX,
  Heart,
  LayoutGrid,
  Library,
  ListChecks,
  Link2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
} from 'lucide-react'
import { useAppState } from '@/features/use-app-state'
import { confirmAction } from '@/store/confirm'
import { useLibraryActions } from './use-library-actions'
import { useUiStore } from '@/store/ui'
import { cn, formatCount } from '@/lib/utils'
import { post } from '@/lib/api'
import { Progress } from '@/components/ui/progress'
import type { DownloadItem, Row } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/stat-card'
import { LibraryTable } from './library-table'
import { LibraryGallery } from './library-gallery'
import { PreviewDialog } from './preview-dialog'
import { filterRows, sortRows, type LibraryFilters, type SortDir, type SortKey } from './library-filters'
import { SelectionBar } from './selection-bar'
import { CollectionPicker } from './collection-picker'
import { ScrapeDialog, LinkScrapeDialog } from './scrape-dialog'
import type { RowMenuActions } from './row-context-menu'

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'new', label: '待下载' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '下载失败' },
]

const FLAG_OPTIONS = [
  { value: 'none', label: '不限标记' },
  { value: 'fav', label: '★ 收藏' },
  { value: 'towatch', label: '待看' },
  { value: 'watched', label: '已看' },
  { value: 'have', label: '在磁盘' },
  { value: 'miss', label: '未下载' },
  { value: 'rated', label: '已评分' },
  { value: 'top', label: '高分 ≥4★' },
  { value: 'today', label: '今日新增' },
]

const RES_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '1080', label: '1080p+' },
  { value: '720', label: '720p+' },
  { value: '4k', label: '4K+' },
  { value: 'portrait', label: '竖屏' },
]

const SORT_OPTIONS = [
  { value: 'rank:asc', label: '排名从高到低' },
  { value: 'views:desc', label: '观看最多' },
  { value: 'likes:desc', label: '点赞最多' },
  { value: 'rating:desc', label: '评分最高' },
  { value: 'duration:desc', label: '时长最长' },
  { value: 'first_seen:desc', label: '最新入库' },
  { value: 'file_size:desc', label: '文件最大' },
]

const PER_OPTIONS = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '0', label: '全部' },
]

type SavedView = {
  name: string; query: string; status: string; source: string; flag: string; res: string; minDur: string; sortKey: SortKey; sortDir: SortDir; per: number
}

export function LibraryPage() {
  const { data, isLoading, error, refetch, isFetching } = useAppState()
  const downloadMap = React.useMemo(() => new Map<string, DownloadItem>((data?.download?.items || []).map(item => [item.token, item])), [data?.download?.items])
  const actions = useLibraryActions()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const collectionId = Number(searchParams.get('collection')) || null
  const batchMode = searchParams.get('batch') === '1'

  const view = useUiStore(s => s.view)
  const setView = useUiStore(s => s.setView)
  const multi = useUiStore(s => s.multi)
  const setMulti = useUiStore(s => s.setMulti)
  const selected = useUiStore(s => s.selected)
  const setSelected = useUiStore(s => s.setSelected)
  const clearSelected = useUiStore(s => s.clearSelected)
  const toggleSelected = useUiStore(s => s.toggleSelected)
  const previewToken = useUiStore(s => s.previewToken)
  const previewAutoplay = useUiStore(s => s.previewAutoplay)
  const openPreview = useUiStore(s => s.openPreview)
  const closePreview = useUiStore(s => s.closePreview)

const [query, setQuery] = React.useState(searchParams.get('q') || '')
  const deferredQuery = React.useDeferredValue(query)
const [status, setStatus] = React.useState(searchParams.get('status') || 'all')
const [source, setSource] = React.useState(searchParams.get('source') || 'all')
const [flag, setFlag] = React.useState(searchParams.get('flag') || 'none')
const [res, setRes] = React.useState(searchParams.get('res') || 'all')
const [minDur, setMinDur] = React.useState(searchParams.get('minDur') || '')
const [sortKey, setSortKey] = React.useState<SortKey>((searchParams.get('sort')?.split(':')[0] as SortKey) || 'rank')
const [sortDir, setSortDir] = React.useState<SortDir>((searchParams.get('sort')?.split(':')[1] as SortDir) || 'asc')
const [per, setPer] = React.useState(Number(searchParams.get('per')) || 50)
  const [page, setPage] = React.useState(1)
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [pickerTokens, setPickerTokens] = React.useState<string[] | null>(null)
  const [scrapeOpen, setScrapeOpen] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [savedViews, setSavedViews] = React.useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('pektino.views.v1') || '[]') } catch { return [] }
  })

  const collectionItems = useQuery<{ tokens: string[] }>({
    queryKey: ['collection-items', collectionId],
    queryFn: async () => {
      const res = await fetch(`/api/collections/items?id=${collectionId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集失败')
      return res.json()
    },
    enabled: !!collectionId,
    staleTime: 3_000,
  })
  const collections = useQuery<{ items: Array<{ id: number; name: string }> }>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await fetch('/api/collections', { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集失败')
      return res.json()
    },
    enabled: !!collectionId,
    staleTime: 5_000,
  })
  const collectionName = collections.data?.items?.find(c => c.id === collectionId)?.name
  const collectionTokens = React.useMemo(() => new Set(collectionItems.data?.tokens || []), [collectionItems.data?.tokens])
  const baseRows = React.useMemo(() => collectionId ? (data?.rows || []).filter(r => collectionTokens.has(r.token)) : (data?.rows || []), [data?.rows, collectionId, collectionTokens])
  const filters: LibraryFilters = { q: deferredQuery, status, source, flag, res, minDur }
  const filtered = React.useMemo(() => filterRows(baseRows, filters), [baseRows, deferredQuery, status, source, flag, res, minDur])
  const batchSet = React.useMemo(() => {
    if (!batchMode) return null
    let tokens: string[] = []
    try { tokens = JSON.parse(sessionStorage.getItem('pektino.batchTokens') || '[]') } catch { }
    if (!tokens.length) tokens = (data?.job?.progress?.addedTokens || []).filter(Boolean)
    return new Set(tokens)
  }, [batchMode, data?.job?.progress?.addedTokens])
  const batchRows = React.useMemo(() => batchSet ? filtered.filter(row => batchSet.has(row.token)) : filtered, [filtered, batchSet])
  const sorted = React.useMemo(() => sortRows(batchRows, sortKey, sortDir), [batchRows, sortKey, sortDir])
  const pages = per > 0 ? Math.max(1, Math.ceil(sorted.length / per)) : 1
  const safePage = Math.min(page, pages)
  const visible = per > 0 ? sorted.slice((safePage - 1) * per, safePage * per) : sorted

  React.useEffect(() => { setPage(1) }, [deferredQuery, status, source, flag, res, minDur, per, sortKey, sortDir, collectionId, batchMode])
  React.useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])

  React.useEffect(() => {
    const next = new URLSearchParams(window.location.search)
    const put = (key: string, value: string, fallback: string) => { if (value && value !== fallback) next.set(key, value); else next.delete(key) }
    put('q', query, '')
    put('status', status, 'all')
    put('source', source, 'all')
    put('flag', flag, 'none')
    put('res', res, 'all')
    put('minDur', minDur, '')
    put('per', String(per), '50')
    put('sort', `${sortKey}:${sortDir}`, 'rank:asc')
    if (next.toString() !== window.location.search.replace(/^\?/, '')) setSearchParams(next, { replace: true })
  }, [query, status, source, flag, res, minDur, per, sortKey, sortDir, setSearchParams])

  const sourceOptions = React.useMemo(
    () => [{ value: 'all', label: '全部来源' }, ...(data?.sources || []).map(s => ({ value: s.key, label: s.name || s.key }))],
    [data?.sources],
  )

  const filterCount = [res !== 'all', minDur !== ''].filter(Boolean).length
  const hasFilters = filterCount > 0 || query || status !== 'all' || source !== 'all' || flag !== 'none'

  const reset = () => {
    setQuery('')
    setStatus('all')
    setSource('all')
    setFlag('none')
    setRes('all')
    setMinDur('')
    setSortKey('rank')
    setSortDir('asc')
    setPage(1)
  }

  const saveView = () => {
    const name = window.prompt('保存当前筛选视图为：')?.trim()
    if (!name) return
    const view: SavedView = { name, query, status, source, flag, res, minDur, sortKey, sortDir, per }
    const next = [...savedViews.filter(v => v.name !== name), view]
    setSavedViews(next)
    try { localStorage.setItem('pektino.views.v1', JSON.stringify(next)) } catch { }
    toast.success('视图已保存')
  }

  const applyView = (name: string) => {
    const view = savedViews.find(v => v.name === name)
    if (!view) return
    setQuery(view.query)
    setStatus(view.status)
    setSource(view.source)
    setFlag(view.flag)
    setRes(view.res)
    setMinDur(view.minDur)
    setSortKey(view.sortKey)
    setSortDir(view.sortDir)
    setPer(view.per)
    setPage(1)
  }

  const sort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'rank' || key === 'title' ? 'asc' : 'desc')
    }
  }

  const togglePage = (checked: boolean) => {
    const pageTokens = visible.map(r => r.token)
    const pageSet = new Set(pageTokens)
    if (checked) setSelected([...new Set([...selected, ...pageTokens])])
    else setSelected(selected.filter(t => !pageSet.has(t)))
  }

  const onFav = (row: Row) => {
    actions.fav([row.token], row.fav !== '1')
  }

  const selectedRows = (data?.rows || []).filter(r => selected.includes(r.token))

  const menu: RowMenuActions = {
    open: openPreview,
    download: async row => {
      if (await confirmAction({ title: '开始下载', description: `把「${row.title?.trim() || row.token}」加入下载队列？`, confirmText: '开始下载' })) {
        await actions.download([row.token])
      }
    },
    fav: row => actions.fav([row.token], row.fav !== '1'),
    collection: row => setPickerTokens([row.token]),
    watched: row => actions.watched([row.token], !row.last_play),
    rate: (row, value) => actions.rate([row.token], value),
    recycle: async row => {
      if (await confirmAction({ title: '移入回收站', description: `删除「${row.title?.trim() || row.token}」？可在回收站恢复。`, confirmText: '移入回收站', danger: true })) {
        actions.recycle([row.token])
      }
    },
    copy: row => actions.copy([row.token], data?.rows || []),
    reveal: row => actions.reveal(row.token),
    markDone: row => actions.mark([row.token], 'done'),
  }

  const bulkDownload = async () => {
    if (await confirmAction({ title: '批量下载', description: `把已选 ${selected.length} 条加入下载队列？`, confirmText: '开始下载' })) {
      await actions.download(selected)
    }
  }
  const bulkRecycle = async () => {
    if (await confirmAction({ title: '移入回收站', description: `把已选 ${selected.length} 条移入回收站？可在回收站恢复。`, confirmText: '移入回收站', danger: true })) {
      actions.recycle(selected)
    }
  }

  const gacha = () => {
    const all = (data?.rows || []).filter(r => r.file_name)
    if (!all.length) { toast.error('没有可播放的本地条目'); return }
    const pool = previewToken ? all.filter(r => r.token !== previewToken) : all
    const list = pool.length ? pool : all
    openPreview(list[Math.floor(Math.random() * list.length)].token, true)
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'r') return
      const target = e.target as HTMLElement | null
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable]')) return
      const dialogs = document.querySelectorAll('[role="dialog"]').length
      if (previewToken ? dialogs > 1 : dialogs > 0) return
      e.preventDefault()
      gacha()
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body) active.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewToken, data?.rows])

  const addedTokens = (data?.job?.progress?.addedTokens || []).filter(Boolean)
  const enterBatch = () => {
    if (!addedTokens.length) return
    setQuery('')
    setStatus('all')
    setSource('all')
    setFlag('none')
    setRes('all')
    setMinDur('')
    try { sessionStorage.setItem('pektino.batchTokens', JSON.stringify(addedTokens)) } catch { }
    const next = new URLSearchParams(searchParams)
    next.set('batch', '1')
    setSearchParams(next)
  }
  const exitBatch = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('batch')
    setSearchParams(next)
  }

  if (isLoading) return <LibrarySkeleton />

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-[var(--radius-card)] border border-[color:color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_5%,var(--surface))] p-6">
          <div className="text-[10px] tracking-[.6px] text-[color:var(--danger)]">API OFFLINE</div>
          <h2 className="mt-1 text-[16px] font-semibold">读取台账失败</h2>
          <p className="mt-2 max-w-[520px] text-[11.5px] leading-5 text-[color:var(--muted)]">
            {(error as Error).message}。确认 8791 控制台仍在运行，Vite 的 `/api` 代理会转发到它。
          </p>
          <Button className="mt-4" size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RotateCcw className={cn('size-3.5', isFetching && 'animate-spin')} /> 重试
          </Button>
        </div>
      </div>
    )
  }

  const stats = data?.stats
  const job = data?.job as { running?: boolean; rank?: string; progress?: { phase?: string; done?: number; total?: number } } | undefined
  const sourceLabel = source === 'all' ? '全部来源' : (data?.sources || []).find(s => s.key === source)?.name || source
  const flagLabel = FLAG_OPTIONS.find(f => f.value === flag)?.label || '不限标记'

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        <StatCard icon={Library} label="总数" value={formatCount(stats?.total || 0)} active={status === 'all' && flag === 'none'} onClick={() => { setStatus('all'); setFlag('none') }} />
        <StatCard icon={Download} label="待下载" value={formatCount(stats?.new || 0)} active={status === 'new'} onClick={() => { setStatus('new'); setFlag('none') }} />
        <StatCard icon={FolderCheck} label="已完成" value={formatCount(stats?.done || 0)} active={status === 'done'} onClick={() => { setStatus('done'); setFlag('none') }} />
        <StatCard icon={Archive} label="在磁盘" value={formatCount(stats?.downloaded || 0)} sub={`磁盘 ${Number(stats?.diskGB || 0).toFixed(1)} GB`} active={flag === 'have'} onClick={() => { setStatus('all'); setFlag('have') }} />
        <StatCard icon={FolderX} label="未下载" value={formatCount(stats?.missing || 0)} active={flag === 'miss'} onClick={() => { setStatus('all'); setFlag('miss') }} />
        <StatCard icon={Heart} label="收藏" value={formatCount(stats?.favorites || 0)} tone="danger" active={flag === 'fav'} onClick={() => { setStatus('all'); setFlag('fav') }} />
        <StatCard icon={Clock3} label="总时长(h)" value={Number(stats?.hours || 0).toFixed(1)} sub={`今日 +${stats?.todayAdded || 0}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--subtle)]" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="查询：token / 标题 / 来源 / 分辨率"
            className="pl-8"
            aria-label="搜索条目"
          />
        </div>
        <Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} className="w-[120px]" aria-label="状态" />
        <Select value={source} onValueChange={setSource} options={sourceOptions} className="w-[120px]" aria-label="来源" />
        <Select value={flag} onValueChange={setFlag} options={FLAG_OPTIONS} className="w-[120px]" aria-label="标记" />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className={cn(filterCount > 0 && 'border-[color:var(--primary)] text-[color:var(--primary-2)]')}>
              <SlidersHorizontal className="size-3.5" /> 筛选{filterCount > 0 ? ` ${filterCount}` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-3">
            <div className="space-y-3">
              <div>
                <div className="ui-field-label mb-1.5">分辨率</div>
                <Select value={res} onValueChange={setRes} options={RES_OPTIONS} className="w-full" aria-label="分辨率" />
              </div>
              <div>
                <div className="ui-field-label mb-1.5">最短时长</div>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} value={minDur} onChange={e => setMinDur(e.target.value)} placeholder="不限" className="h-8" />
                  <span className="text-[10px] text-[color:var(--subtle)]">分钟</span>
                </div>
              </div>
              <div>
                <div className="ui-field-label mb-1.5">快捷排序</div>
                <Select
                  value={`${sortKey}:${sortDir}`}
                  onValueChange={value => {
                    const [k, d] = value.split(':') as [SortKey, SortDir]
                    setSortKey(k)
                    setSortDir(d)
                  }}
                  options={SORT_OPTIONS}
                  className="w-full"
                  aria-label="快捷排序"
                />
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => { setRes('all'); setMinDur('') }}>
                <RotateCcw className="size-3.5" /> 重置筛选
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!hasFilters}>
          <RotateCcw className="size-3.5" /> 重置
        </Button>
        <Button size="sm" variant="ghost" onClick={saveView}>保存视图</Button>
        {savedViews.length ? (
          <select value="" onChange={e => applyView(e.target.value)} className="h-7 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 text-[10px] text-[color:var(--muted)] outline-none">
            <option value="">选择视图</option>
            {savedViews.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        ) : null}
        <div className="ml-auto flex items-center gap-1 rounded-[9px] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-0.5">
          <Button size="sm" variant={view === 'table' ? 'outline' : 'ghost'} className="h-7 px-2" onClick={() => setView('table')} aria-pressed={view === 'table'}>
            <Table2 className="size-3.5" /> 表格
          </Button>
          <Button size="sm" variant={view === 'gallery' ? 'outline' : 'ghost'} className="h-7 px-2" onClick={() => setView('gallery')} aria-pressed={view === 'gallery'}>
            <LayoutGrid className="size-3.5" /> 画廊
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" onClick={() => setScrapeOpen(true)}>
          <Plus className="size-3.5" /> 获取数据
        </Button>
        <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
          <Link2 className="size-3.5" /> 链接抓取
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate('/queue')}>
          <Download className="size-3.5" /> 下载队列
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/collections')}>
          <Library className="size-3.5" /> 合集
        </Button>
        <Button size="sm" variant={multi ? 'outline' : 'ghost'} onClick={() => setMulti(!multi)}>
          <ListChecks className="size-3.5" /> 多选
        </Button>
        <Button size="sm" variant="ghost" onClick={gacha} title="随机播放一部本地视频（快捷键 R）">
          <Sparkles className="size-3.5" /> 抽一卡
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setStatus('all'); setFlag('towatch') }}>
          <CalendarClock className="size-3.5" /> 待看
        </Button>
        {batchMode ? (
          <Button size="sm" variant="outline" onClick={exitBatch}>退出本批</Button>
        ) : addedTokens.length ? (
          <Button size="sm" variant="ghost" onClick={enterBatch}>本批新增 {addedTokens.length}</Button>
        ) : null}
        {multi && selected.length > 0 ? (
          <div className="ml-auto flex items-center gap-2 text-[10px] text-[color:var(--muted)]">
            <span>已选 {selected.length}</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={clearSelected}>清空</Button>
          </div>
        ) : null}
      </div>

      {job?.running ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_6%,var(--surface))] px-3 py-2">
          <span className="shrink-0 text-[10px] text-[color:var(--primary-2)]">
            {job.progress?.phase || '抓取中'}{job.rank ? ` · ${job.rank}` : ''}
          </span>
          <Progress value={job.progress?.total ? Math.round(((job.progress.done || 0) / job.progress.total) * 100) : 0} className="max-w-[360px]" />
          <span className="text-[9.5px] text-[color:var(--subtle)]">
            {job.progress?.done || 0}/{job.progress?.total || 0}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={async () => { await post('/api/job/cancel', {}); toast.success('已请求取消'); refetch() }}>取消任务</Button>
        </div>
      ) : null}

      {batchMode ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--primary)_6%,var(--surface))] px-3 py-2 text-[10px] text-[color:var(--primary-2)]">
          临时视图：本批新增 {batchSet?.size || 0} 条
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={exitBatch}>退出本批</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] text-[color:var(--subtle)]">
          共 <b className="text-[color:var(--foreground)]">{sorted.length}</b> 条
          {source !== 'all' ? ` · ${sourceLabel}` : ''}
          {flag !== 'none' ? ` · ${flagLabel}` : ''}
          {query ? ` · 搜索“${query}”` : ''}
          {collectionId ? ` · 合集「${collectionName || collectionId}」` : ''}
          {collectionId ? (
            <button type="button" onClick={() => setSearchParams({})} className="ml-1 text-[color:var(--primary-2)] hover:underline">清除合集</button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[color:var(--subtle)]">
          {isFetching ? <span className="text-[color:var(--primary-2)]">同步中…</span> : null}
          <span>共 {pages} 页</span>
        </div>
      </div>

      <div className="ui-scroll min-h-0 flex-1 overflow-auto pr-0.5">
        {view === 'table' ? (
          <LibraryTable
            rows={visible}
            selected={selected}
            onToggle={toggleSelected}
            onTogglePage={togglePage}
            onOpen={openPreview}
            onFav={onFav}
            onRate={menu.rate}
            multi={multi}
            menu={menu}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={sort}
          />
        ) : (
            <LibraryGallery rows={visible} downloads={downloadMap} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onFav={onFav} onRate={menu.rate} onDownload={menu.download} menu={menu} />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3">
        <div className="text-[10px] text-[color:var(--subtle)]">
          {sorted.length ? `${(safePage - 1) * (per || sorted.length) + 1}-${Math.min(safePage * (per || sorted.length), sorted.length)} / ${sorted.length}` : '0 / 0'}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[10px] text-[color:var(--subtle)]">每页</span>
          <Select value={String(per)} onValueChange={v => setPer(Number(v))} options={PER_OPTIONS} className="w-[76px] h-8" aria-label="每页条数" />
          <Button size="icon-sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(1)} aria-label="第一页"><ChevronsLeft className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="上一页"><ChevronLeft className="size-3.5" /></Button>
          {pageNumbers(safePage, pages).map(n => (
            <Button key={n} size="icon-sm" variant={n === safePage ? 'default' : 'ghost'} onClick={() => setPage(n)} aria-label={`第 ${n} 页`}>{n}</Button>
          ))}
          <Button size="icon-sm" variant="ghost" disabled={safePage >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} aria-label="下一页"><ChevronRight className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" disabled={safePage >= pages} onClick={() => setPage(pages)} aria-label="最后一页"><ChevronsRight className="size-3.5" /></Button>
        </div>
      </div>

      <PreviewDialog
        rows={sorted}
        token={previewToken}
        downloadItem={previewToken ? downloadMap.get(previewToken) : undefined}
        autoplay={previewAutoplay}
        media={data?.media}
        onClose={closePreview}
        onNavigate={openPreview}
        onFav={onFav}
      />

      <SelectionBar
        count={multi ? selected.length : 0}
        onDownload={bulkDownload}
        onCollection={() => setPickerTokens(selected)}
        onRecycle={bulkRecycle}
        onFav={() => actions.fav(selected, true)}
        onWatched={() => actions.watched(selected, true)}
        onMarkDone={() => actions.mark(selected, 'done')}
        onCopy={() => actions.copy(selected, data?.rows || [])}
        onClear={clearSelected}
      />

      <CollectionPicker
        open={pickerTokens !== null}
        tokens={pickerTokens || []}
        onOpenChange={open => { if (!open) setPickerTokens(null) }}
      />
      <ScrapeDialog open={scrapeOpen} onOpenChange={setScrapeOpen} sources={data?.sources || []} />
      <LinkScrapeDialog open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  )
}

function pageNumbers(page: number, pages: number) {
  const out: number[] = []
  const start = Math.max(1, Math.min(page - 2, pages - 4))
  const end = Math.min(pages, start + 4)
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

function LibrarySkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[68px] rounded-[12px]" />)}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-[34px] flex-1" />
        <Skeleton className="h-[34px] w-[120px]" />
        <Skeleton className="h-[34px] w-[120px]" />
        <Skeleton className="h-[34px] w-[120px]" />
      </div>
      <Skeleton className="h-[420px] rounded-[14px]" />
    </div>
  )
}
