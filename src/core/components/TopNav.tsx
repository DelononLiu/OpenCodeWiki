import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Clock, Plus, LogOut } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'

interface TopNavProps {
  title?: string
  subtitle?: string
  showNewTask?: boolean
  onNewTask?: () => void
  onOpenHistory?: () => void
}

export function TopNav({ title, subtitle, showNewTask, onNewTask, onOpenHistory }: TopNavProps) {
  const { toggleTheme } = useUIStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex items-center justify-between h-12 px-6 border-b border-border shadow-sm bg-background shrink-0">
      <div className="flex items-center gap-2" onClick={() => navigate('/')}>
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none" className="cursor-pointer">
          <rect width="32" height="32" rx="6" fill="#1677ff" />
          <path d="M16 6l8 12H8l8-12z" fill="white" />
          <circle cx="16" cy="22" r="3" fill="white" />
        </svg>
        <span className="text-sm font-semibold tracking-tight cursor-pointer">Taskit</span>
        {title && (
          <>
            <div className="w-px h-4 bg-muted" />
            <span className="text-xs font-mono font-medium">{title}</span>
          </>
        )}
        {subtitle && (
          <>
            <span className="text-xs text-muted-foreground font-mono">|</span>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-5">
        {showNewTask && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={onNewTask}>
            <Plus className="h-3.5 w-3.5" />
            新建任务
          </Button>
        )}

        {onOpenHistory && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={onOpenHistory}>
            <Clock className="h-3.5 w-3.5" />
            历史任务
          </Button>
        )}

        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={toggleTheme}>☀</button>

        {user ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center hover:bg-primary/20 transition-colors"
            >
              {(user.name || user.email)[0].toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-36 rounded-md border border-muted bg-card shadow-md py-1">
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground truncate">{user.email}</div>
                  <hr className="border-muted my-1" />
                  <button
                    onClick={() => { logout(); navigate('/login'); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <LogOut className="h-3 w-3" />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => navigate('/login')}
            className="text-xs text-primary hover:underline"
          >
            登录
          </button>
        )}
      </div>
    </div>
  )
}
