import { useState, useEffect } from 'react'
import { fetchReviewQueue, fetchWikiModules, approveDraft, rejectDraft, fetchTopic } from '@/api/client'
import { DraftEditor } from '@/components/knowledge/DraftEditor'
import type { ReviewItem } from '@/types'
import { Loader2, ChevronDown, ChevronRight, CheckCircle, XCircle, BookOpen, Eye } from 'lucide-react'

interface WikiReviewCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function WikiReviewCard({ expanded, onToggle, onUpdate }: WikiReviewCardProps) {
  const [queue, setQueue] = useState<ReviewItem[]>([])
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const [selectedModule, setSelectedModule] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [qaEntries, setQaEntries] = useState<{qid: number; question: string; answer?: string | null}[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchReviewQueue().then(d => setQueue(d.queue || [])).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  const handleSelect = async (item: ReviewItem) => {
    setSelectedItem(item)
    setFeedback(null)
    setShowRejectInput(false)
    if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].slug)
    // Fetch QA entries for reviewer context
    try {
      const topic = await fetchTopic(item.topic_slug) as any
      setQaEntries(topic.qa_entries || [])
    } catch {
      setQaEntries([])
    }
  }

  const handleApprove = async () => {
    if (!selectedItem || !selectedModule) return
    setLoading(true)
    try {
      await approveDraft(selectedItem.topic_slug, selectedModule)
      setQueue(prev => prev.filter(i => i.topic_slug !== selectedItem.topic_slug))
      setSelectedItem(null)
      setFeedback('✅ 已发布到 Wiki 并索引到检索库')
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 发布失败: ${e.message}`)
    }
    setLoading(false)
  }

  const handleReject = async () => {
    if (!selectedItem) return
    setLoading(true)
    try {
      await rejectDraft(selectedItem.topic_slug, rejectReason || '需要进一步修改')
      setQueue(prev => prev.filter(i => i.topic_slug !== selectedItem.topic_slug))
      setSelectedItem(null)
      setShowRejectInput(false)
      setRejectReason('')
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 驳回失败: ${e.message}`)
    }
    setLoading(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">④ Wiki 审核</span>
          {queue.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-cyber-green/10 text-cyber-green text-[10px] font-bold">
              {queue.length} 待审核
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {selectedItem ? (
            <>
              <button onClick={() => { setSelectedItem(null); setShowRejectInput(false) }}
                className="text-xs text-gray-500 hover:text-cyber-blue">← 返回审核列表</button>

              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-gray-800">#{selectedItem.topic_slug}</span>
                <span className="text-sm text-gray-600">{selectedItem.topic_name}</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">🆕 新 Draft</span>
              </div>

              <DraftEditor
                qaEntries={qaEntries}
                draftContent={selectedItem.edited_content || selectedItem.raw_content}
                onChange={() => {}}
                readOnly
              />

              {feedback && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  feedback.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'
                }`}>
                  {feedback}
                </div>
              )}

              {/* Module selector + actions */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-400" />
                  <span className="text-xs text-gray-600">目标模块:</span>
                  <select value={selectedModule} onChange={e => setSelectedModule(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                    {modules.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                  </select>
                </div>

                <div className="flex gap-2">
                  {showRejectInput ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="驳回理由..."
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-48"
                      />
                      <button onClick={handleReject} disabled={loading}
                        className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
                        确认驳回
                      </button>
                      <button onClick={() => setShowRejectInput(false)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                        取消
                      </button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => setShowRejectInput(true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50">
                        <XCircle className="w-3 h-3" /> 驳回
                      </button>
                      <button onClick={handleApprove} disabled={!selectedModule || loading}
                        className="inline-flex items-center gap-1 px-4 py-1.5 bg-cyber-blue text-white text-xs rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        批准发布
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {queue.map(item => (
                <button key={item.topic_slug} onClick={() => handleSelect(item)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{item.topic_slug}</span>
                    <span className="text-xs text-gray-500">{item.topic_name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">🆕</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{item.updated_at?.slice(0, 10)}</span>
                    <Eye className="w-3 h-3 text-gray-400" />
                  </div>
                </button>
              ))}
              {queue.length === 0 && (
                <div className="text-center text-gray-400 py-4 text-sm">
                  暂无待审核的 Draft，提交后在阶段③中操作
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
