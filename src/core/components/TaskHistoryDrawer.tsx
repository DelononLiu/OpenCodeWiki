import { useState, useEffect } from 'react'
import { Search, Clock, FileIcon, RotateCw } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { getTaskHistory, retryTask } from '@/api/task'

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

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'completed', label: '完成' },
  { key: 'failed', label: '失败' },
  { key: 'running', label: '运行中' },
  { key: 'cancelled', label: '已取消' },
]

export function TaskHistoryDrawer({ open, onOpenChange, onSelect }: Props) {
  const [tasks, setTasks] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const useMock = import.meta.env.VITE_USE_MOCK !== 'false'
    if (useMock) {
      import('@/tasks/model_diff/mockData').then(({ MOCK_TASKS }) => {
        setTasks(MOCK_TASKS as any)
        setLoading(false)
      })
    } else {
      getTaskHistory()
        .then((items) => setTasks(items as any))
        .catch(() => setTasks([]))
        .finally(() => setLoading(false))
    }
  }, [open])

  const filtered = tasks.filter((t) => {
    if (filter && t.status !== filter) return false
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleRetry = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const t = await retryTask(id)
    onSelect(t.id)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-sm">历史任务</SheetTitle>
        </SheetHeader>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring"
            placeholder="搜索任务..."
          />
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] transition-colors',
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Task list */}
        <div className="space-y-1">
          {loading && <p className="text-[11px] text-muted-foreground/60 text-center py-4">加载中...</p>}
          {!loading && filtered.length === 0 && <p className="text-[11px] text-muted-foreground/60 text-center py-4">暂无匹配任务</p>}
          {filtered.map((t) => (
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
                    <span className={cn('text-[10px]', t.accuracy?.includes('完成') ? 'text-pass' : 'text-warn')}>{t.accuracy}</span>
                  )}
                  {t.status === 'failed' && <span className="text-[10px] text-fail">{t.accuracy}</span>}
                  {t.status === 'running' && <span className="text-[10px] text-primary">运行中</span>}
                  {t.status === 'cancelled' && <span className="text-[10px] text-muted-foreground">已取消</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span className="font-mono">{t.model}</span>
                  <span>·</span>
                  <Clock className="h-3 w-3" />
                  <span>{t.date}</span>
                </div>
              </div>
              {t.status === 'failed' && (
                <button
                  onClick={(e) => handleRetry(e, t.id)}
                  className="shrink-0 flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                  <RotateCw className="h-3 w-3" />
                  重试
                </button>
              )}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
