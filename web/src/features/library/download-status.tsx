import type { DownloadItem, Row } from '@/types'

export function effectiveDownloadStatus(row: Row, item?: DownloadItem) {
  if (row.status !== 'new') return row.status
  return item?.state || 'new'
}

export function downloadPercent(item?: DownloadItem) {
  if (!item?.expected || item.expected <= 0) return 0
  return Math.min(99, Math.max(0, Math.round((Number(item.bytes || 0) / item.expected) * 100)))
}

export function downloadButtonLabel(row: Row, item?: DownloadItem) {
  const state = effectiveDownloadStatus(row, item)
  const pct = downloadPercent(item)
  switch (state) {
    case 'queued': return '排队中'
    case 'downloading': return pct > 0 ? `下载中 ${pct}%` : '下载中'
    case 'paused': return '已暂停'
    case 'failed': return '下载失败'
    case 'dead': return '源失效'
    case 'cancelled': return '已取消'
    case 'done': return '已完成'
    default: return '下载'
  }
}

export function isDownloadBusy(row: Row, item?: DownloadItem) {
  return ['queued', 'downloading', 'paused'].includes(effectiveDownloadStatus(row, item))
}