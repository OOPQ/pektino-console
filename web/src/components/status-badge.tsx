import { Badge } from '@/components/ui/badge'
import { statusOf } from '@/lib/utils'

export function StatusBadge({ status }: { status: string }) {
  const s = statusOf(status)
  return <Badge tone={s.tone}>{s.label}</Badge>
}
