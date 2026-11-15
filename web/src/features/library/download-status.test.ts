import { describe, expect, it } from 'vitest'
import { downloadButtonLabel, isDownloadBusy } from './download-status'
import type { DownloadItem, Row } from '@/types'

const row = { token: 'x', status: 'new' } as Row
const item = (patch: Partial<DownloadItem>): DownloadItem => ({ token: 'x', state: 'queued', bytes: 0, ...patch })

describe('download button state', () => {
  it('shows queue progress states', () => {
    expect(downloadButtonLabel(row, item({ state: 'queued' }))).toBe('排队中')
    expect(downloadButtonLabel(row, item({ state: 'downloading', bytes: 50, expected: 100 }))).toBe('下载中 50%')
    expect(downloadButtonLabel(row, item({ state: 'paused' }))).toBe('已暂停')
    expect(downloadButtonLabel(row, item({ state: 'dead' }))).toBe('源失效')
    expect(downloadButtonLabel(row, item({ state: 'cancelled' }))).toBe('已取消')
  })

  it('does not show an active state for a completed row', () => {
    expect(downloadButtonLabel({ ...row, status: 'done' } as Row, item({ state: 'downloading' }))).toBe('已完成')
    expect(isDownloadBusy({ ...row, status: 'done' } as Row, item({ state: 'downloading' }))).toBe(false)
  })
})
