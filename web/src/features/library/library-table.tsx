import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Download,
  Play,
  Star,
} from 'lucide-react'
import type { Row } from '@/types'
import { cn, formatCount, formatDate, rowTitle } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { RatingInput } from '@/components/rating-input'
import { StatusBadge } from '@/components/status-badge'
import { CoverImage } from '@/components/cover-image'
import type { SortDir, SortKey } from './library-filters'
import { RowContextMenu, type RowMenuActions } from './row-context-menu'

type Props = {
  rows: Row[]
  selected: string[]
  onToggle: (token: string) => void
  onTogglePage: (checked: boolean) => void
  onOpen: (token: string, autoplay?: boolean) => void
  onFav: (row: Row) => void
  onRate: (row: Row, value: number) => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  multi: boolean
  menu: RowMenuActions
}

function SortHead({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sortKey === col
  return (
    <th className={cn('px-2 py-2 text-left font-medium', className)}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn('inline-flex items-center gap-1 text-[9.5px] tracking-[.4px] text-[color:var(--subtle)] hover:text-[color:var(--foreground)]', active && 'text-[color:var(--foreground)]')}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
        ) : (
          <ChevronDown className="size-3 opacity-30" />
        )}
      </button>
    </th>
  )
}

export function LibraryTable({
  rows,
  selected,
  onToggle,
  onTogglePage,
  onOpen,
  onFav,
  onRate,
  sortKey,
  sortDir,
  onSort,
  multi,
  menu,
}: Props) {
  const pageTokens = rows.map(r => r.token)
  const selectedOnPage = pageTokens.filter(t => selected.includes(t)).length
  const allSelected = pageTokens.length > 0 && selectedOnPage === pageTokens.length
  const someSelected = selectedOnPage > 0 && !allSelected
  const [copied, setCopied] = React.useState<string | null>(null)

  const copy = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.page_url || row.url)
      setCopied(row.token)
      window.setTimeout(() => setCopied(c => (c === row.token ? null : c)), 1600)
    } catch (e) {}
  }

  return (
    <div className="overflow-auto rounded-[var(--radius-card)] border border-[color:var(--border)] bg-[color:var(--surface)]">
      <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
        <thead className="sticky top-0 z-10 bg-[color:var(--surface-2)]">
          <tr className="border-b border-[color:var(--border)]">
            {multi ? (
              <th className="w-9 px-2 py-2">
                <Checkbox
                  aria-label="全选本页"
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={checked => onTogglePage(checked === true)}
                />
              </th>
            ) : null}
            <th className="w-[54px] px-2 py-2 text-left text-[9.5px] tracking-[.4px] text-[color:var(--subtle)]">封面</th>
            <SortHead label="标题" col="title" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHead label="排名" col="rank" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-14" />
            <SortHead label="时长" col="duration" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16" />
            <th className="w-[92px] px-2 py-2 text-left text-[9.5px] tracking-[.4px] text-[color:var(--subtle)]">分辨率</th>
            <SortHead label="观看" col="views" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16" />
            <SortHead label="点赞" col="likes" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-16" />
            <SortHead label="评分" col="rating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-[86px]" />
            <SortHead label="入库" col="first_seen" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-[104px]" />
            <th className="w-[72px] px-2 py-2 text-left text-[9.5px] tracking-[.4px] text-[color:var(--subtle)]">状态</th>
            <th className="sticky right-0 z-20 w-[104px] border-l border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-2 text-right text-[9.5px] tracking-[.4px] text-[color:var(--subtle)]">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isSelected = selected.includes(row.token)
            return (
              <RowContextMenu key={row.token} row={row} actions={menu}>
              <tr
                className={cn(
                  'group border-b border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] transition-colors last:border-0 hover:bg-[color:color-mix(in_srgb,var(--primary)_4%,transparent)]',
                  isSelected && 'bg-[color:color-mix(in_srgb,var(--primary)_6%,transparent)]',
                )}
              >
                {multi ? (
                  <td className="px-2 py-2.5">
                    <Checkbox
                      aria-label={`选择 ${rowTitle(row)}`}
                      checked={isSelected}
                      onCheckedChange={() => onToggle(row.token)}
                    />
                  </td>
                ) : null}
                <td className="px-2 py-2.5">
                  <button type="button" onClick={() => onOpen(row.token, true)} className="block" aria-label="打开预览">
                    <CoverImage token={row.token} alt={rowTitle(row)} className="h-[62px] w-[46px] rounded-[7px]" />
                  </button>
                </td>
                <td className="min-w-0 px-2 py-2.5">
                  <button type="button" onClick={() => onOpen(row.token)} className="block max-w-full text-left">
                    <div className="truncate text-[11.5px] font-medium text-[color:var(--foreground)] hover:text-[color:var(--primary-2)]">
                      {row.title?.trim() || row.token}
                    </div>
                    <div className="mt-0.5 truncate text-[9.5px] text-[color:var(--subtle)]">
                      <span className="ui-mono">{row.title?.trim() ? row.token : row.source || row.site || '—'}</span>
                      <span className="mx-1.5 opacity-40">·</span>
                      {formatDate(row.first_seen)}
                    </div>
                  </button>
                </td>
                <td className="px-2 py-1.5 text-[color:var(--muted)]">{row.rank || '—'}</td>
                <td className="px-2 py-1.5 text-[color:var(--muted)]">{row.duration || '—'}</td>
                <td className="px-2 py-1.5 text-[10px] text-[color:var(--muted)]">{row.res || '—'}</td>
                <td className="px-2 py-1.5 text-[10px] text-[color:var(--muted)]">{formatCount(row.views)}</td>
                <td className="px-2 py-1.5 text-[10px] text-[color:var(--muted)]">{formatCount(row.likes)}</td>
                <td className="px-2 py-2.5"><RatingInput value={row.rating} onChange={value => onRate(row, value)} /></td>
                <td className="px-2 py-2.5 text-[10px] text-[color:var(--muted)]">{formatDate(row.first_seen)}</td>
                <td className="px-2 py-2.5"><StatusBadge status={row.status} /></td>
<td className="sticky right-0 border-l border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-2.5 group-hover:bg-[color:color-mix(in_srgb,var(--primary)_4%,var(--surface))]">
                  <div className="flex items-center justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    <IconButton label="预览 / 播放" size="sm" onClick={() => onOpen(row.token, true)}>
                      <Play className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={row.fav === '1' ? '取消收藏' : '收藏'}
                      size="sm"
                      className={row.fav === '1' ? 'text-[color:var(--danger)]' : 'text-[color:var(--muted)]'}
                      onClick={() => onFav(row)}
                    >
                      <Star className={cn('size-3.5', row.fav === '1' && 'fill-current')} />
                    </IconButton>
                    <IconButton label={copied === row.token ? '已复制' : '复制链接'} size="sm" onClick={() => copy(row)}>
                      <Copy className={cn('size-3.5', copied === row.token && 'text-[color:var(--success)]')} />
                    </IconButton>

                  </div>
                </td>
              </tr>
              </RowContextMenu>
            )
          })}
        </tbody>
      </table>
      {!rows.length ? (
        <div className="grid min-h-[220px] place-items-center px-6 text-center">
          <div>
            <div className="text-[12px] font-medium">没有符合条件的条目</div>
            <div className="mt-1 text-[10px] text-[color:var(--subtle)]">试试清空查询或筛选条件。</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
