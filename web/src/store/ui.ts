import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'table' | 'gallery'
export type Theme = 'dark' | 'light'
export type Density = 'compact' | 'cozy' | 'large'

type UiState = {
  sidebarCollapsed: boolean
  view: ViewMode
  theme: Theme
  density: Density
  multi: boolean
  selected: string[]
  previewToken: string | null
  previewAutoplay: boolean
  toggleSidebar: () => void
  setView: (view: ViewMode) => void
  setTheme: (theme: Theme) => void
  setDensity: (density: Density) => void
  setMulti: (multi: boolean) => void
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
      density: 'large',
      multi: false,
      selected: [],
      previewToken: null,
      previewAutoplay: false,
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setView: view => set({ view }),
      setTheme: theme => {
        applyTheme(theme)
        set({ theme })
      },
      setDensity: density => set({ density }),
      setMulti: multi => set(multi ? { multi } : { multi, selected: [] }),
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
      partialize: s => ({ sidebarCollapsed: s.sidebarCollapsed, view: s.view, theme: s.theme, density: s.density }),
      onRehydrateStorage: () => state => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
