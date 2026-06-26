import { Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'

export function Header() {
  const { theme, toggleTheme } = useUIStore()
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b bg-background">
      <div
        onClick={() => navigate('/')}
        className="flex items-center gap-2 cursor-pointer"
      >
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="#1677ff" />
          <path d="M16 6l8 12H8l8-12z" fill="white" />
          <circle cx="16" cy="22" r="3" fill="white" />
        </svg>
        <span className="text-lg font-bold">ModelDiff</span>
      </div>

      <Button variant="ghost" size="icon" onClick={toggleTheme}>
        {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Button>
    </header>
  )
}
