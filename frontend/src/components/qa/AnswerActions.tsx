import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Copy, Share2, Check } from 'lucide-react'

interface AnswerActionsProps {
  onAccept: () => void
  onReject: () => void
  onCopy: () => void
  onShare: () => void
  accepted: boolean
  rejected: boolean
  rootQid?: number
  onPromoteTopic?: (title: string) => void
  /** 非最后一条时仅 hover 显示按钮 */
  showOnHover?: boolean
}

export function AnswerActions({
  onAccept, onReject, onCopy, onShare,
  accepted, rejected, rootQid, onPromoteTopic,
  showOnHover,
}: AnswerActionsProps) {
  const [showPromote, setShowPromote] = useState(false)
  const [topicTitle, setTopicTitle] = useState('')

  const handleAccept = () => {
    onAccept()
    setShowPromote(true)
  }

  const handlePromote = () => {
    const title = topicTitle.trim()
    if (title && onPromoteTopic) {
      onPromoteTopic(title)
      setShowPromote(false)
      setTopicTitle('')
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {/* Action bar — last message always visible, others on hover */}
      <div className={`flex items-center gap-1 text-gray-400 select-none transition-opacity duration-150 ${
        showOnHover ? 'opacity-0 group-hover:opacity-100' : ''
      }`}>
        <button
          className={`p-1.5 rounded-lg transition ${
            accepted ? 'bg-emerald-50 text-emerald-500' : 'hover:bg-gray-100 hover:text-emerald-500'
          }`}
          onClick={handleAccept}
          disabled={accepted || rejected}
          title="采纳"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          className={`p-1.5 rounded-lg transition ${
            rejected ? 'bg-red-50 text-red-500' : 'hover:bg-gray-100 hover:text-red-500'
          }`}
          onClick={onReject}
          disabled={accepted || rejected}
          title="待验证"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-gray-700 transition" onClick={onCopy} title="复制">
          <Copy className="w-3.5 h-3.5" />
        </button>
        {rootQid && (
          <button className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-cyber-blue transition" onClick={onShare} title="复制分享链接">
            <Share2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Accepted feedback */}
      {accepted && (
        <span className="text-[10px] font-medium text-emerald-500 flex items-center gap-1 mt-1">
          <Check className="w-3 h-3" /> 已采纳
        </span>
      )}

      {/* Topic promotion — only after accept */}
      {showPromote && onPromoteTopic && (
        <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
          <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2">
            升级为 Topic
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={topicTitle}
              onChange={e => setTopicTitle(e.target.value)}
              placeholder="输入 Topic 标题..."
              className="flex-1 px-2.5 py-1.5 text-xs border border-indigo-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
            />
            <button
              onClick={handlePromote}
              disabled={!topicTitle.trim()}
              className="px-3 py-1.5 text-[10px] font-bold bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-40 transition shrink-0"
            >
              确认
            </button>
            <button
              onClick={() => setShowPromote(false)}
              className="px-3 py-1.5 text-[10px] font-medium text-indigo-400 hover:text-indigo-600 transition shrink-0"
            >
              暂缓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
