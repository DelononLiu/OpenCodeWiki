import { ThumbsUp, ThumbsDown, BookOpen, CheckCircle2, XCircle, Library } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QaStatus } from './types'

interface FeedbackBarProps {
  /** 是否为最新（最后一条）回答 */
  isLatest: boolean
  /** 当前状态 */
  status: QaStatus
  /** 是否已沉淀到 Wiki */
  wikiPromoted: boolean
  /** 点击采纳 */
  onApprove: () => void
  /** 点击驳回 */
  onReject: () => void
  /** 点击沉淀到 Wiki */
  onWikiPromote: () => void
}

export function FeedbackBar({
  isLatest,
  status,
  wikiPromoted,
  onApprove,
  onReject,
  onWikiPromote,
}: FeedbackBarProps) {
  // 已采纳｜已驳回 → 显示状态标签，不显示按钮
  if (status !== 'pending') {
    return (
      <div className={cn(
        'mt-3 pt-2 border-t border-gray-100 select-none',
        isLatest ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
      )}>
        <div className="flex items-center gap-2">
          {status === 'approved' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-[11px] font-medium">
              <CheckCircle2 className="w-3 h-3" />
              已采纳
            </span>
          )}
          {status === 'rejected' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 text-[11px] font-medium">
              <XCircle className="w-3 h-3" />
              已驳回
            </span>
          )}
          {wikiPromoted && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 text-[11px] font-medium">
              <Library className="w-3 h-3" />
              已沉淀
            </span>
          )}
        </div>
      </div>
    )
  }

  // 待处理 → 显示操作按钮
  return (
    <div className={cn(
      'mt-3 pt-2 border-t border-gray-100 select-none',
      isLatest ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
    )}>
      <div className="flex items-center gap-1">
        <button
          onClick={onApprove}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
          title="采纳"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
          采纳
        </button>
        <button
          onClick={onReject}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          title="驳回"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
          驳回
        </button>
        <button
          onClick={onWikiPromote}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
          title="沉淀到Wiki"
        >
          <BookOpen className="w-3.5 h-3.5" />
          沉淀到Wiki
        </button>
      </div>
    </div>
  )
}
