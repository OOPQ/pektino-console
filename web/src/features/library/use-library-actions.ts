import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { post } from '@/lib/api'
import { copyText } from '@/lib/utils'
import { unlockAudio } from '@/lib/sound'

export function useLibraryActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['state'] })

  const download = async (tokens: string[], limit = 0) => {
    unlockAudio()
    try {
      const r = await post<{ ok: boolean; error?: string; started?: number }>('/api/download', {
        tokens,
        limit,
        status: 'new',
      })
      if (!r.ok) throw new Error(r.error || '开始下载失败')
      toast.success(`已加入下载队列${r.started ? ` · ${r.started} 条` : ''}`, {
        action: { label: '查看队列', onClick: () => navigate('/queue') },
      })
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const fav = async (tokens: string[], on: boolean) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/fav', { tokens, on })
      if (!r.ok) throw new Error(r.error || '操作失败')
      toast.success(on ? '已收藏' : '已取消收藏')
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const mark = async (tokens: string[], status: string) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/mark', { tokens, status })
      if (!r.ok) throw new Error(r.error || '操作失败')
      toast.success(status === 'done' ? '已标记完成' : '已更新状态')
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const watched = async (tokens: string[], on: boolean) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/watched', { tokens, on })
      if (!r.ok) throw new Error(r.error || '操作失败')
      toast.success(on ? '已标记已看' : '已取消已看')
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const rate = async (tokens: string[], value: number) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/rate', { tokens, value })
      if (!r.ok) throw new Error(r.error || '评分失败')
      toast.success(value ? `已评分 ${value} 星` : '已清除评分')
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const recycle = async (tokens: string[]) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/mark', { tokens, status: 'recycled' })
      if (!r.ok) throw new Error(r.error || '移入回收站失败')
      toast.success(`已移入回收站 · ${tokens.length} 条`, {
        action: {
          label: '撤销',
          onClick: async () => {
            try {
              const rr = await post<{ ok: boolean; error?: string }>('/api/restore', { tokens })
              if (!rr.ok) throw new Error(rr.error || '撤销失败')
              toast.success('已撤销')
              invalidate()
            } catch (e) {
              toast.error((e as Error).message)
            }
          },
        },
      })
      invalidate()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const reveal = async (token: string) => {
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/reveal', { token })
      if (!r.ok) throw new Error(r.error || '定位失败')
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const copy = async (tokens: string[], rows: Array<{ token: string; url: string; page_url: string }>) => {
    const urls = tokens.map(t => {
      const row = rows.find(r => r.token === t)
      return row?.page_url || row?.url || ''
    }).filter(Boolean)
    if (!urls.length) return
    if (await copyText(urls.join('\n'))) toast.success(`已复制 ${urls.length} 个链接`)
    else toast.error('复制失败')
  }

  return { download, fav, mark, watched, rate, recycle, reveal, copy }
}
