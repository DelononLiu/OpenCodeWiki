import { create } from 'zustand'

interface UIState {
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      if (next === 'light') {
        document.documentElement.classList.add('light')
      } else {
        document.documentElement.classList.remove('light')
      }
      return { theme: next }
    }),
}))
