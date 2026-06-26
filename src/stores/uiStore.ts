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
      if (next === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return { theme: next }
    }),
}))
