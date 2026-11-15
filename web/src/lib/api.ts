import type { AppState } from '@/types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body?.error || body?.message || message
    } catch (e) {}
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function fetchState(signal?: AbortSignal): Promise<AppState> {
  const res = await fetch('/api/state', { signal, cache: 'no-store' })
  return json<AppState>(res)
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return json<T>(res)
}
