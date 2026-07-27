import { ThumbsUp, XCircle, Library, MessageSquare } from 'lucide-react'
import type { FeedbackStats as Stats } from './types'

interface FeedbackStatsProps {
  stats: Stats
}

export function FeedbackStats({ stats }: FeedbackStatsProps) {
  const items = [
    { count: stats.approvedCount, label: '已采纳', icon: ThumbsUp, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { count: stats.rejectedCount, label: '已驳回', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
    { count: stats.wikiPromotedCount, label: '已沉淀', icon: Library, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { count: stats.correctionCount, label: '纠错', icon: MessageSquare, color: 'text-amber-500', bg: 'bg-amber-50' },
  ]

  const total = items.reduce((sum, it) => sum + it.count, 0)
  if (total === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="text-xs font-medium text-gray-400">QA 反馈</span>
      <div className="flex items-center gap-2">
        {items.map(item => {
          if (item.count === 0) return null
          const Icon = item.icon
          return (
            <div
              key={item.label}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${item.bg}`}
            >
              <Icon className={`w-3 h-3 ${item.color}`} />
              <span className={`text-[11px] font-medium ${item.color}`}>
                {item.count} {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
