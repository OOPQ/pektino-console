import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderPlus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { post } from '@/lib/api'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

type Collection = {
  id: number
  name: string
  color: string
  count: number
  has?: boolean
}

export function CollectionPicker({
  open,
  tokens,
  onOpenChange,
}: {
  open: boolean
  tokens: string[]
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState<number | 'new' | null>(null)

  const { data, isLoading } = useQuery<{ items: Collection[] }>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await fetch('/api/collections', { cache: 'no-store' })
      if (!res.ok) throw new Error('读取合集失败')
      return res.json()
    },
    enabled: open,
    staleTime: 5_000,
  })

  const after = () => {
    qc.invalidateQueries({ queryKey: ['collections'] })
    qc.invalidateQueries({ queryKey: ['state'] })
    onOpenChange(false)
  }

  const add = async (id: number) => {
    setBusy(id)
    try {
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'add', id, tokens })
      if (!r.ok) throw new Error(r.error || '加入失败')
      toast.success('已加入合集')
      after()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const n = name.trim()
    if (!n) return
    setBusy('new')
    try {
      const c = await post<{ ok: boolean; id?: number; error?: string }>('/api/collections', { action: 'create', name: n })
      if (!c.ok || !c.id) throw new Error(c.error || '新建失败')
      const r = await post<{ ok: boolean; error?: string }>('/api/collections', { action: 'add', id: c.id, tokens })
      if (!r.ok) throw new Error(r.error || '加入失败')
      setName('')
      toast.success('已新建并加入合集')
      after()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="加入合集"
        description={`已选 ${tokens.length} 条`}
        className="w-[min(460px,calc(100vw-40px))]"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[9.5px] text-[color:var(--subtle)]">加入后可在合集页继续管理</span>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        }
      >
        <div className="p-4">
          <div className="flex gap-2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="新建合集名称" onKeyDown={e => { if (e.key === 'Enter') create() }} />
            <Button size="sm" onClick={create} disabled={!name.trim() || busy === 'new'}>
              <Plus className="size-3.5" /> 新建
            </Button>
          </div>

          <div className="mt-3 max-h-[360px] space-y-1.5 overflow-auto">
            {isLoading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-11 rounded-lg" />) : null}
            {!isLoading && !data?.items?.length ? (
              <div className="rounded-lg border border-[color:var(--border)] p-6 text-center text-[11px] text-[color:var(--subtle)]">
                还没有合集，先新建一个。
              </div>
            ) : null}
            {data?.items?.map(col => (
              <button
                key={col.id}
                type="button"
                disabled={busy !== null}
                onClick={() => add(col.id)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--border-strong)] disabled:opacity-50"
              >
                <span className="size-2.5 rounded-full" style={{ background: col.color || 'var(--primary)' }} />
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{col.name}</span>
                <span className="text-[9px] text-[color:var(--subtle)]">{col.count} 条</span>
                {col.has ? <Check className="size-3.5 text-[color:var(--success)]" /> : <FolderPlus className="size-3.5 text-[color:var(--subtle)]" />}
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
