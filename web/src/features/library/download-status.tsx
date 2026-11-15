import type { DownloadItem, Row } from '@/types'
import { Badge } from '@/components/ui/badge'
import { statusOf } from '@/lib/utils'

export function effectiveDownloadStatus(row: Row, item?: DownloadItem) {
  if (row.status !== 'new') return row.status
  return item?.state || 'new'
}

export function DownloadStatus({ row, item }: { row: Row; item?: DownloadItem }) {
  const state = effectiveDownloadStatus(row, item)
  const info = statusOf(state)
  const pct = item?.expected && item.expected > 0
    ? Math.min(99, Math.max(0, Math.round((Number(item.bytes || 0) / item.expected) * 100)))
    : 0
  const label = state === 'downloading' && pct > 0 ? `下载中 ${pct}%` : info.label
  return (
    <Badge tone={info.tone} title={item?.error || info.label}>
      {label}
    </Badge>
  )
}
