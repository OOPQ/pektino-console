import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchState, post } from '@/lib/api'
import type { AppState } from '@/types'

export function useAppState() {
  return useQuery<AppState>({
    queryKey: ['state'],
    queryFn: ({ signal }) => fetchState(signal),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  })
}

export function useToggleFav() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ token, on }: { token: string; on: boolean }) =>
      post<{ ok: boolean }>('/api/fav', { tokens: [token], on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['state'] }),
  })
}
