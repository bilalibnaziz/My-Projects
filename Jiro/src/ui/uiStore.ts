import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

interface UiState {
  voteMode: boolean
  presenting: boolean
  slide: number
  framesPanel: boolean
  command: boolean
  shortcuts: boolean
  minimap: boolean
  exportOpen: boolean
  templatesOpen: boolean
  teamOpen: boolean
  shareOpen: boolean
  tasksPanel: boolean
  notesPanel: boolean
  versionsPanel: boolean
  linkOpen: boolean
  theme: Theme
  set(p: Partial<Omit<UiState, 'set' | 'setTheme'>>): void
  setTheme(t: Theme): void
}

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : d
  } catch {
    return d
  }
}

export const useUi = create<UiState>()((set) => ({
  voteMode: false,
  presenting: false,
  slide: 0,
  framesPanel: false,
  command: false,
  shortcuts: false,
  minimap: read('jiro.minimap', true),
  exportOpen: false,
  templatesOpen: false,
  teamOpen: false,
  shareOpen: false,
  tasksPanel: false,
  notesPanel: false,
  versionsPanel: false,
  linkOpen: false,
  theme: read<Theme>('jiro.theme', 'light'),
  set(p) {
    set(p)
    if ('minimap' in p) localStorage.setItem('jiro.minimap', JSON.stringify(p.minimap))
  },
  setTheme(theme) {
    localStorage.setItem('jiro.theme', JSON.stringify(theme))
    set({ theme })
    applyTheme(theme)
  },
}))

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
