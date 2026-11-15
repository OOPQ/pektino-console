import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'table' | 'gallery'
export type Theme = 'dark' | 'light'

type UiState = {
  sidebarCollapsed: boolean
  view: ViewMode
  theme: Theme
  selected: string[]
  previewToken: string | null
  previewAutoplay: boolean
  toggleSidebar: () => void
  setView: (view: ViewMode) => void
  setTheme: (theme: Theme) => void
  toggleSelected: (token: string) => void
  setSelected: (tokens: string[]) => void
  clearSelected: () => void
  openPreview: (token: string, autoplay?: boolean) => void
  closePreview: () => void
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('light', theme === 'light')
  try { localStorage.setItem('pektino.theme', theme) } catch (e) {}
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      view: 'table',
      theme: 'dark',
      selected: [],
      previewToken: null,
      previewAutoplay: false,
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setView: view => set({ view }),
      setTheme: theme => {
        applyTheme(theme)
        set({ theme })
      },
      toggleSelected: token => set(s => ({
        selected: s.selected.includes(token) ? s.selected.filter(t => t !== token) : [...s.selected, token],
      })),
      setSelected: tokens => set({ selected: tokens }),
      clearSelected: () => set({ selected: [] }),
      openPreview: (token, autoplay = false) => set({ previewToken: token, previewAutoplay: autoplay }),
      closePreview: () => set({ previewToken: null, previewAutoplay: false }),
    }),
    {
      name: 'pektino.ui',
      partialize: s => ({ sidebarCollapsed: s.sidebarCollapsed, view: s.view, theme: s.theme }),
      onRehydrateStorage: () => state => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
