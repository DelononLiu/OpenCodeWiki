import { useState, useEffect, useCallback } from 'react'
import { fetchReviews, reviewItem, fetchItem } from '@/api/opencodewiki'
import type { ReviewTask, KnowledgeItem } from '@/types/opencodewiki'
import { Loader2, Check, X, Eye } from 'lucide-react'

export function ReviewPanel() {
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<{ task: ReviewTask; item: KnowledgeItem } | null>(null)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchReviews().then(setTasks).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const openDetail = async (task: ReviewTask) => {
    try {
      const item = await fetchItem(task.item_id)
      setDetail({ task, item })
      setReason('')
    } catch {}
  }

  const act = async (action: 'approve' | 'reject') => {
    if (!detail) return
    if (action === 'reject' && !reason.trim()) { setToast('驳回需填写理由'); return }
    setActing(true)
    try {
      await reviewItem(detail.task.item_id, action, reason)
      setToast(action === 'approve' ? '已批准并发布' : '已驳回')
      setDetail(null)
      load()
    } catch (e: any) {
      setToast(e.message || '操作失败')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">待审文章</h2>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
      </div>
      {toast && <div className="text-xs text-cyber-blue bg-cyber-blue/10 rounded-lg px-3 py-2">{toast}</div>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">暂无待审文章</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-800 truncate">{t.title}</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">提交于 {t.created_at?.slice(0, 10)}</p>
              </div>
              <button onClick={() => openDetail(t)}
                className="flex items-center gap-1 text-xs text-cyber-blue border border-cyber-blue/30 rounded-lg px-2.5 py-1 hover:bg-cyber-blue/10 shrink-0 ml-3">
                <Eye className="w-3 h-3" /> 审阅
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-[640px] max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">{detail.item.title}</h2>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 text-sm text-gray-700 whitespace-pre-wrap">{detail.item.content_md}</div>
            <div className="p-5 border-t border-gray-100 space-y-3">
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="审批意见（驳回必填）"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyber-blue" />
              <div className="flex justify-end gap-2">
                <button onClick={() => act('reject')} disabled={acting}
                  className="flex items-center gap-1 text-xs text-red-500 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 disabled:opacity-50">
                  <X className="w-3.5 h-3.5" /> 驳回
                </button>
                <button onClick={() => act('approve')} disabled={acting}
                  className="flex items-center gap-1 text-xs text-white bg-emerald-500 rounded-lg px-3 py-2 hover:bg-emerald-600 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> 批准发布
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
