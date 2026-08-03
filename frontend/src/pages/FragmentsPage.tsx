import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchFragments, createFragment, publishItem, draftArticle } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { StickyNote, Loader2, Send, Sparkles, Check } from 'lucide-react'

export function FragmentsPage() {
  const navigate = useNavigate()
  const [fragments, setFragments] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drafting, setDrafting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchFragments().then(setFragments).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const handleCapture = async () => {
    if (!content.trim()) return
    setCapturing(true)
    try {
      await createFragment(content.trim())
      setContent('')
      showToast('碎片已捕获')
      load()
    } catch (e: any) {
      showToast(e.message || '捕获失败')
    } finally {
      setCapturing(false)
    }
  }

  const handlePublish = async (id: string) => {
    try {
      await publishItem(id)
      showToast('已发布到团队')
      load()
    } catch (e: any) {
      showToast(e.message || '发布失败')
    }
  }

  const handleDraftArticle = async () => {
    if (selected.size === 0) return
    setDrafting(true)
    try {
      const art = await draftArticle([...selected])
      navigate(`/cards`, { state: { highlight: art.id } })
    } catch (e: any) {
      showToast(e.message || '起草失败')
    } finally {
      setDrafting(false)
    }
  }

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-lg font-bold text-gray-900">我的碎片</h1>
            <p className="text-xs text-gray-400 mt-1">捕获零散知识，发布后沉淀为团队卡片</p>
          </div>

          {/* Capture box */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="随手记下一段知识碎片，例如：'Flux 模式要求单向数据流，store 只能通过 action 更新'"
              rows={3}
              className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400">{content.length} 字</span>
              <button onClick={handleCapture} disabled={capturing || !content.trim()}
                className="flex items-center gap-1.5 bg-cyber-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
                {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                捕获为卡片
              </button>
            </div>
          </div>

          {toast && <div className="text-xs text-cyber-blue bg-cyber-blue/10 rounded-lg px-3 py-2">{toast}</div>}

          {/* List */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : fragments.length === 0 ? (
            <div className="text-center py-16">
              <StickyNote className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">还没有碎片，从上方捕获第一条吧</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fragments.map(f => (
                <div key={f.id} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)}
                    className="mt-1 accent-cyber-blue" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800 truncate">{f.title}</h3>
                      <span className="text-[10px] text-gray-300 shrink-0">{f.created_at?.slice(0, 10)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-3">{f.content_md}</p>
                  </div>
                  <button onClick={() => handlePublish(f.id)}
                    className="self-start flex items-center gap-1 text-xs text-cyber-blue border border-cyber-blue/30 rounded-lg px-2.5 py-1 hover:bg-cyber-blue/10 shrink-0">
                    <Sparkles className="w-3 h-3" /> 发布到团队
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected.size > 0 && (
            <button onClick={handleDraftArticle} disabled={drafting}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-gray-900 text-white rounded-full px-5 py-2.5 text-sm shadow-lg hover:bg-gray-800 disabled:opacity-50">
              {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              选中 {selected.size} 张，起草文章
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
