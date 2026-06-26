import { useState, useEffect } from 'react'
import { Search, Clock, FileIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { getTaskHistory } from '@/api/task'

interface HistoryItem {
  id: string
  name: string
  model: string
  date: string
  status: string
  accuracy?: string
  progress?: number
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSelect: (id: string) => void
}

export function TaskHistoryDrawer({ open, onOpenChange, onSelect }: Props) {
  const [tasks, setTasks] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const useMock = import.meta.env.VITE_USE_MOCK !== 'false'
    if (useMock) {
      import('@/modules/model_diff/mockData').then(({ MOCK_TASKS }) => {
        setTasks(MOCK_TASKS as any)
        setLoading(false)
      })
    } else {
      getTaskHistory()
        .then((items) => { setTasks(items as any); console.log('history loaded', items.length, 'items') })
        .catch(() => setTasks([]))
        .finally(() => setLoading(false))
    }
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-sm">历史任务</SheetTitle>
        </SheetHeader>
        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input className="w-full h-8 rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring" placeholder="搜索任务..." />
        </div>
        <div className="space-y-1">
          {loading && <p className="text-[11px] text-muted-foreground/60 text-center py-4">加载中...</p>}
          {!loading && tasks.length === 0 && <p className="text-[11px] text-muted-foreground/60 text-center py-4">暂无历史任务</p>}
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => { onOpenChange(false); onSelect(t.id) }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-accent text-left transition-colors"
            >
              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{t.name}</span>
                  {t.status === 'completed' && (
                    <span className={cn(
                      'text-[10px]',
                      t.accuracy?.includes('完美') ? 'text-pass' : t.accuracy?.includes('超标') ? 'text-warn' : 'text-fail'
                    )}>{t.accuracy}</span>
                  )}
                  {t.status === 'failed' && <span className="text-[10px] text-fail">{t.accuracy}</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span className="font-mono">{t.model}</span>
                  <span>·</span>
                  <Clock className="h-3 w-3" />
                  <span>{t.date}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
