import { Button } from '@/components/ui/button'
import { Clock, Plus } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'

interface TopNavProps {
  title?: string
  subtitle?: string
  showNewTask?: boolean
  onNewTask?: () => void
  onOpenHistory?: () => void
}

export function TopNav({ title, subtitle, showNewTask, onNewTask, onOpenHistory }: TopNavProps) {
  const { toggleTheme } = useUIStore()

  return (
    <div className="flex items-center justify-between h-12 px-6 border-b border-muted shrink-0">
      <div className="flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#1677ff" />
          <path d="M16 6l8 12H8l8-12z" fill="white" />
          <circle cx="16" cy="22" r="3" fill="white" />
        </svg>
        <span className="text-sm font-semibold tracking-tight">ModelDiff</span>
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

      <div className="flex items-center gap-3">
        {showNewTask && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={onNewTask}>
            <Plus className="h-3.5 w-3.5" />
            建立新分析任务
          </Button>
        )}

        {onOpenHistory && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={onOpenHistory}>
            <Clock className="h-3.5 w-3.5" />
            历史任务
          </Button>
        )}

        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={toggleTheme}>☀</button>
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
          <span className="text-xs text-muted-foreground">👤</span>
        </div>
      </div>
    </div>
  )
}
