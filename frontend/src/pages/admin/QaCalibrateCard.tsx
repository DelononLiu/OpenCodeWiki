import { useState, useEffect } from 'react'
import { fetchQaEntries, calibrateQaEntry } from '@/api/client'
import type { QaEntry } from '@/types'
import { CheckCircle, Eye, ChevronDown, ChevronRight } from 'lucide-react'

interface QaCalibrateCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function QaCalibrateCard({ expanded, onToggle, onUpdate }: QaCalibrateCardProps) {
  const [pendingQa, setPendingQa] = useState<QaEntry[]>([])
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchQaEntries({ status: 'pending', limit: 50 })
      .then(d => setPendingQa(d.entries))
      .catch(() => {})
  }, [])

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    setLoading(true)
    await calibrateQaEntry(qid, answer)
    setPendingQa(prev => prev.filter(e => e.qid !== qid))
    setCalAnswers(prev => { const n = { ...prev }; delete n[qid]; return n })
    setLoading(false)
    onUpdate()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">① QA 校准</span>
          {pendingQa.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {pendingQa.length} 待校准
            </span>
          )}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {pendingQa.map(e => (
            <div key={e.qid} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyber-blue font-bold">#Q{e.qid}</span>
                <span className="text-sm font-medium">{e.question}</span>
              </div>
              {e.answer && (
                <p className="text-xs text-gray-500 bg-white rounded p-2 max-h-24 overflow-y-auto">
                  {e.answer}
                </p>
              )}
              <textarea
                value={calAnswers[e.qid] ?? ''}
                onChange={evt => setCalAnswers(prev => ({ ...prev, [e.qid]: evt.target.value }))}
                placeholder="输入校准答案..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => window.open(`/qa?qid=${e.qid}`, '_blank')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  <Eye className="w-3 h-3" /> 查看
                </button>
                <button onClick={() => handleCalibrate(e.qid)}
                  disabled={!calAnswers[e.qid]?.trim() || loading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                  <CheckCircle className="w-3 h-3" /> 校准
                </button>
              </div>
            </div>
          ))}
          {pendingQa.length === 0 && (
            <div className="text-center text-gray-400 py-4 text-sm">✅ 暂无待校准条目</div>
          )}
        </div>
      )}
    </div>
  )
}
