import type { Row } from '@/types'
import { resQuality, rowTitle } from '@/lib/utils'

export type SortKey = 'rank' | 'title' | 'duration' | 'views' | 'likes' | 'first_seen' | 'file_size' | 'rating'
export type SortDir = 'asc' | 'desc'

export type LibraryFilters = {
  q: string
  status: string
  source: string
  flag: string
  res: string
  minDur: string
}

const today = () => new Date().toISOString().slice(0, 10)

export function filterRows(rows: Row[], f: LibraryFilters) {
  const q = f.q.trim().toLowerCase()
  const parts = q ? q.split(/\s+/).filter(Boolean) : []
  const min = Number(f.minDur) || 0
  const todayStr = today()

  return rows.filter(row => {
    if (row.status === 'recycled') return false
    if (f.status !== 'all' && row.status !== f.status) return false
    if (f.source !== 'all' && row.source !== f.source) return false

    switch (f.flag) {
      case 'fav': if (row.fav !== '1') return false; break
      case 'towatch': if (!row.file_name || row.last_play) return false; break
      case 'watched': if (!row.last_play) return false; break
      case 'have': if (!row.file_name) return false; break
      case 'miss': if (row.file_name) return false; break
      case 'rated': if (!Number(row.rating)) return false; break
      case 'top': if (Number(row.rating) < 4) return false; break
      case 'today': if (!(row.first_seen || '').startsWith(todayStr)) return false; break
      default: break
    }

    const quality = resQuality(row.res)
    if (f.res === 'portrait' && !quality?.portrait) return false
    if (f.res === '1080' && (!quality || quality.short < 1080)) return false
    if (f.res === '720' && (!quality || quality.short < 720)) return false
    if (f.res === '4k' && (!quality || quality.short < 2160)) return false

    if (min > 0 && (Number(row.seconds) || 0) < min * 60) return false

    if (parts.length) {
      const hay = [
        row.token,
        row.title,
        row.source,
        row.site,
        row.res,
        row.duration,
        row.note,
      ].join(' ').toLowerCase()
      if (!parts.every(part => hay.includes(part))) return false
    }
    return true
  })
}

function rankValue(row: Row) {
  return row.rank === '' || row.rank == null ? null : Number(row.rank)
}

export function sortRows(rows: Row[], key: SortKey, dir: SortDir) {
  const mult = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let av: number | string | null = null
    let bv: number | string | null = null
    switch (key) {
      case 'rank':
        av = rankValue(a)
        bv = rankValue(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        break
      case 'title':
        av = rowTitle(a).toLowerCase()
        bv = rowTitle(b).toLowerCase()
        break
      case 'duration':
        av = Number(a.seconds) || 0
        bv = Number(b.seconds) || 0
        break
      case 'views':
        av = Number(a.views) || 0
        bv = Number(b.views) || 0
        break
      case 'likes':
        av = Number(a.likes) || 0
        bv = Number(b.likes) || 0
        break
      case 'rating':
        av = Number(a.rating) || 0
        bv = Number(b.rating) || 0
        break
      case 'file_size':
        av = Number(a.file_size) || 0
        bv = Number(b.file_size) || 0
        break
      case 'first_seen':
        av = a.first_seen || ''
        bv = b.first_seen || ''
        break
    }
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv, 'zh-CN') * mult
    return ((av as number) - (bv as number)) * mult
  })
}
