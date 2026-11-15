import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Row } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | string, digits = 1) {
  const n = Number(bytes) || 0
  if (!n) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(digits)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(digits)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(digits)} KB`
  return `${n} B`
}

export function formatCount(n: number | string) {
  const v = Number(n) || 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}w`
  return v.toLocaleString('zh-CN')
}

export function formatTime(seconds: number | string) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function formatDate(value: string) {
  if (!value) return '—'
  const d = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return value
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function rowTitle(row: Row) {
  return row.title?.trim() || row.token
}

export function rowFileSize(row: Row) {
  return Number(row.file_size) || 0
}

export function resQuality(res: string) {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(res || '')
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  const short = Math.min(w, h)
  return { w, h, short, portrait: h > w }
}

export const STATUS: Record<string, { label: string; tone: 'ok' | 'new' | 'live' | 'bad' | 'muted' }> = {
  done: { label: '已完成', tone: 'ok' },
  new: { label: '待下载', tone: 'new' },
  downloading: { label: '下载中', tone: 'live' },
  queued: { label: '排队中', tone: 'live' },
  paused: { label: '已暂停', tone: 'muted' },
  failed: { label: '失败', tone: 'bad' },
  dead: { label: '源失效', tone: 'bad' },
  cancelled: { label: '已取消', tone: 'muted' },
  recycled: { label: '回收站', tone: 'muted' },
}

export function statusOf(status: string) {
  return STATUS[status] || { label: status || '未知', tone: 'muted' as const }
}

export function coverUrl(token: string, full = false) {
  return `/api/cover?token=${encodeURIComponent(token)}${full ? '&full=1' : ''}`
}

export function mediaUrl(base: string, key: string, token: string, bust: number) {
  if (!base || !key) return ''
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(token)}.mp4?k=${encodeURIComponent(key)}&v=${bust}`
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
