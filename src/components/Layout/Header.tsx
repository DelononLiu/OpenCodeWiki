import { Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'

export function Header() {
  const { theme, toggleTheme } = useUIStore()
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between h-12 px-5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div
        onClick={() => navigate('/')}
        className="flex items-center gap-2.5 cursor-pointer select-none"
      >
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#1677ff" />
          <path d="M16 6l8 12H8l8-12z" fill="white" />
          <circle cx="16" cy="22" r="3" fill="white" />
        </svg>
        <span className="text-sm font-semibold tracking-tight">ModelDiff</span>
      </div>

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
        {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </Button>
    </header>
  )
}
