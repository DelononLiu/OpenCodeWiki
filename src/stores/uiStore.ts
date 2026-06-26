import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'light' ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', next)
      return { theme: next }
    }),
}))
