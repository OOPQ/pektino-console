export type DownloadItem = {
  token: string
  state: string
  bytes: number
  expected?: number
  speed?: number
  error?: string
  history?: boolean
  addedAt?: string
}

export type Row = {
  token: string
  status: string
  fav: string
  rank: string
  page: string
  duration: string
  seconds: string
  res: string
  views: string
  likes: string
  uploaded: string
  url: string
  page_url: string
  site: string
  source: string
  source_id: string
  title: string
  cover_url: string
  download_kind: string
  download_headers: string
  extra: string
  first_seen: string
  last_seen: string
  sent_at: string
  note: string
  file_name: string
  file_path: string
  file_size: string
  file_date: string
  play_count: string
  last_play: string
  rating: string
  recycled_at?: string
  recycled_from?: string
}

export type Stats = {
  total: number
  new: number
  done: number
  recycled: number
  failed: number
  hours: number
  todayAdded: number
  byRes?: Record<string, number>
  busy?: boolean
  downloaded: number
  missing: number
  favorites: number
  watched: number
  toWatch: number
  diskGB: number
  contentDir: string
  fileCount: number
  coverMissing?: number
  ledgerPath?: string
  lastSeen?: string
}

export type Source = {
  key: string
  name: string
  pageSize?: number
  capabilities?: string[]
  ranks?: Array<{ key: string; label: string; group?: string }>
}

export type MediaConfig = {
  base: string
  key: string
}

export type AppSettings = {
  proxy?: string
  concurrent?: number
  ffmpegPath?: string
  qiseCookie?: string
}

export type Snapshot = {
  isCover?: boolean
  name: string
  time: number
  createdAt: string
  url: string
}

export type JobProgress = {
  phase?: string
  done?: number
  total?: number
  elapsed?: number
  speed?: number
  eta?: number
  at?: string
  added?: number
  updated?: number
  count?: number
  kind?: string
  error?: string
  finishedAt?: number
  addedTokens?: string[]
}

export type Job = {
  running?: boolean
  elapsed?: number
  rank?: string
  progress?: JobProgress | null
}

export type AppState = {
  ok: boolean
  api: number
  rev: number
  rowsRev: number
  stats: Stats
  sources: Source[]
  media: MediaConfig
  settings: AppSettings
  rows: Row[]
  download?: {
    running?: boolean
    paused?: boolean
    phase?: string
    total?: number
    done?: number
    failed?: number
    queued?: number
    pausedCount?: number
    bytes?: number
    speed?: number
    pid?: number
    active?: string[]
    errors?: Array<{ token?: string; error?: string }>
    items?: DownloadItem[]
  }
  job?: Job
  log?: unknown
  project?: unknown
  resume?: unknown
  metrics?: unknown
}
