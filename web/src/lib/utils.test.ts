import { describe, expect, it } from 'vitest'
import { coverUrl, formatTime } from './utils'
import { filterRows, sortRows } from '@/features/library/library-filters'
import type { Row } from '@/types'

const row = (patch: Partial<Row>): Row => ({
  token: 'token',
  status: 'new',
  fav: '',
  rank: '',
  page: '',
  duration: '',
  seconds: '',
  res: '',
  views: '',
  likes: '',
  uploaded: '',
  url: '',
  page_url: '',
  site: '',
  source: '',
  source_id: '',
  title: '',
  cover_url: '',
  download_kind: '',
  download_headers: '',
  extra: '',
  first_seen: '',
  last_seen: '',
  sent_at: '',
  note: '',
  file_name: '',
  file_path: '',
  file_size: '',
  file_date: '',
  play_count: '',
  last_play: '',
  rating: '',
  ...patch,
})

const filters = { q: '', status: 'all', source: 'all', flag: 'none', res: 'all', minDur: '' }

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(3661)).toBe('1:01:01')
  })
})

describe('coverUrl', () => {
  it('builds thumb and full urls', () => {
    expect(coverUrl('a b')).toBe('/api/cover?token=a%20b')
    expect(coverUrl('abc', true)).toBe('/api/cover?token=abc&full=1')
  })
})

describe('library filters', () => {
  it('keeps recycled rows out of the normal ledger', () => {
    const rows = [row({ token: 'ok' }), row({ token: 'bin', status: 'recycled' })]
    expect(filterRows(rows, filters).map(r => r.token)).toEqual(['ok'])
  })

  it('sorts ratings descending', () => {
    const rows = [row({ token: 'a', rating: '2' }), row({ token: 'b', rating: '5' }), row({ token: 'c', rating: '' })]
    expect(sortRows(rows, 'rating', 'desc').map(r => r.token)).toEqual(['b', 'a', 'c'])
  })
})
