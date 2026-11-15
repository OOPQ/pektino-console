import * as React from 'react'
import { useNavigate } from 'react-router-dom'
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
  Link2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
} from 'lucide-react'
import { useAppState, useToggleFav } from '@/features/use-app-state'
import { useUiStore } from '@/store/ui'
import { cn, formatCount } from '@/lib/utils'
import type { Row } from '@/types'
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

export function LibraryPage() {
  const { data, isLoading, error, refetch, isFetching } = useAppState()
  const toggleFav = useToggleFav()
  const navigate = useNavigate()

  const view = useUiStore(s => s.view)
  const setView = useUiStore(s => s.setView)
  const selected = useUiStore(s => s.selected)
  const setSelected = useUiStore(s => s.setSelected)
  const clearSelected = useUiStore(s => s.clearSelected)
  const toggleSelected = useUiStore(s => s.toggleSelected)
  const previewToken = useUiStore(s => s.previewToken)
  const openPreview = useUiStore(s => s.openPreview)
  const closePreview = useUiStore(s => s.closePreview)

  const [query, setQuery] = React.useState('')
  const deferredQuery = React.useDeferredValue(query)
  const [status, setStatus] = React.useState('all')
  const [source, setSource] = React.useState('all')
  const [flag, setFlag] = React.useState('none')
  const [res, setRes] = React.useState('all')
  const [minDur, setMinDur] = React.useState('')
  const [sortKey, setSortKey] = React.useState<SortKey>('rank')
  const [sortDir, setSortDir] = React.useState<SortDir>('asc')
  const [per, setPer] = React.useState(50)
  const [page, setPage] = React.useState(1)
  const [filterOpen, setFilterOpen] = React.useState(false)

  const filters: LibraryFilters = { q: deferredQuery, status, source, flag, res, minDur }
  const filtered = React.useMemo(() => filterRows(data?.rows || [], filters), [data?.rows, deferredQuery, status, source, flag, res, minDur])
  const sorted = React.useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
  const pages = per > 0 ? Math.max(1, Math.ceil(sorted.length / per)) : 1
  const safePage = Math.min(page, pages)
  const visible = per > 0 ? sorted.slice((safePage - 1) * per, safePage * per) : sorted

  React.useEffect(() => { setPage(1) }, [deferredQuery, status, source, flag, res, minDur, per, sortKey, sortDir])
  React.useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])

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
    toggleFav.mutate({ token: row.token, on: row.fav !== '1' })
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
  const sourceLabel = source === 'all' ? '全部来源' : (data?.sources || []).find(s => s.key === source)?.name || source
  const flagLabel = FLAG_OPTIONS.find(f => f.value === flag)?.label || '不限标记'

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        <StatCard icon={Library} label="总数" value={formatCount(stats?.total || 0)} active={status === 'all' && flag === 'none'} onClick={() => { setStatus('all'); setFlag('none') }} />
        <StatCard icon={Download} label="待下载" value={formatCount(stats?.new || 0)} tone="primary" active={status === 'new'} onClick={() => { setStatus('new'); setFlag('none') }} />
        <StatCard icon={FolderCheck} label="已完成" value={formatCount(stats?.done || 0)} tone="primary" active={status === 'done'} onClick={() => { setStatus('done'); setFlag('none') }} />
        <StatCard icon={Archive} label="在磁盘" value={formatCount(stats?.downloaded || 0)} active={flag === 'have'} onClick={() => { setStatus('all'); setFlag('have') }} />
        <StatCard icon={FolderX} label="未下载" value={formatCount(stats?.missing || 0)} tone="warning" active={flag === 'miss'} onClick={() => { setStatus('all'); setFlag('miss') }} />
        <StatCard icon={Heart} label="收藏" value={formatCount(stats?.favorites || 0)} active={flag === 'fav'} onClick={() => { setStatus('all'); setFlag('fav') }} />
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
        <Button size="sm" variant="default" disabled title="下一批接入">
          <Plus className="size-3.5" /> 获取数据
        </Button>
        <Button size="sm" variant="outline" disabled title="下一批接入">
          <Link2 className="size-3.5" /> 链接抓取
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate('/queue')}>
          <Download className="size-3.5" /> 下载队列
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/collections')}>
          <Library className="size-3.5" /> 合集
        </Button>
        <Button size="sm" variant="ghost" disabled title="下一批接入">
          <Sparkles className="size-3.5" /> 抽一卡
        </Button>
        <Button size="sm" variant="ghost" disabled title="下一批接入">
          <CalendarClock className="size-3.5" /> 待看
        </Button>
        {selected.length > 0 ? (
          <div className="ml-auto flex items-center gap-2 text-[10px] text-[color:var(--muted)]">
            <span>已选 {selected.length}</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={clearSelected}>清空</Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] text-[color:var(--subtle)]">
          共 <b className="text-[color:var(--foreground)]">{sorted.length}</b> 条
          {source !== 'all' ? ` · ${sourceLabel}` : ''}
          {flag !== 'none' ? ` · ${flagLabel}` : ''}
          {query ? ` · 搜索“${query}”` : ''}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[color:var(--subtle)]">
          {isFetching ? <span className="text-[color:var(--primary-2)]">同步中…</span> : null}
          <span>共 {pages} 页</span>
        </div>
      </div>

      {view === 'table' ? (
        <LibraryTable
          rows={visible}
          selected={selected}
          onToggle={toggleSelected}
          onTogglePage={togglePage}
          onOpen={openPreview}
          onFav={onFav}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={sort}
        />
      ) : (
        <LibraryGallery rows={visible} selected={selected} onToggle={toggleSelected} onOpen={openPreview} onFav={onFav} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3">
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
        media={data?.media}
        onClose={closePreview}
        onNavigate={openPreview}
        onFav={onFav}
      />
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
    <div className="space-y-3 p-4">
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
