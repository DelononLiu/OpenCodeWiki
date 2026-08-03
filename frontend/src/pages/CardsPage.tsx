import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchItems, fetchItem, createItem, submitItem } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { LayoutGrid, Loader2, Plus, X, Eye, Send } from 'lucide-react'

type Filter = 'all' | 'team' | 'mine' | 'articles'

const FILTER_TABS: [Filter, string][] = [
  ['all', '全部'],
  ['team', '团队'],
  ['mine', '仅自己'],
  ['articles', '文章草稿'],
]

function fmtTime(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export function CardsPage() {
  const location = useLocation()
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<KnowledgeItem | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [toTeam, setToTeam] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 来自起草流程跳转的高亮项（FragmentsPage 起草文章后 navigate('/cards', { state: { highlight } })）
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    if (filter === 'articles') {
      fetchItems({ form: 'article', scope: 'personal', status: 'draft' })
        .then(setItems)
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }
    fetchItems({ form: 'card' })
      .then(list => setItems(list.filter(i => filter === 'all' || (filter === 'team' ? i.scope === 'team' : i.scope === 'personal'))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])
  useEffect(() => { load() }, [load])

  // 消费 location.state.highlight：匹配项加高亮边框；高亮目标是文章草稿时切到对应 tab
  useEffect(() => {
    const h = (location.state as { highlight?: string } | null)?.highlight
    if (!h) return
    setHighlightId(h)
    fetchItem(h).then(item => {
      if (item.form === 'article') setFilter('articles')
    }).catch(() => {})
    // 消费后清除 state，避免刷新后残留高亮
    window.history.replaceState({}, '')
  }, [location.state])

  const openDetail = async (id: string) => {
    try {
      const item = await fetchItem(id)
      setSelected(item)
    } catch {}
  }

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return
    setSubmitting(true)
    try {
      await createItem({ title: title.trim(), content_md: content.trim(), scope: toTeam ? 'team' : 'personal' })
      setShowCreate(false); setTitle(''); setContent(''); setToTeam(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (item: KnowledgeItem) => {
    try {
      await submitItem(item.id)
      setSubmitMsg(`「${item.title}」已提交审核，等待管理员审批`)
      load()
    } catch (e: any) {
      setSubmitMsg(e.message || '提交失败')
    } finally {
      setTimeout(() => setSubmitMsg(null), 3000)
    }
  }

  const cardCls = (id: string) =>
    `text-left bg-white border rounded-xl p-4 transition-colors ${
      highlightId === id ? 'border-cyber-blue ring-2 ring-cyber-blue/40' : 'border-gray-200 hover:border-cyber-blue/40'
    }`

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">知识卡片</h1>
              <p className="text-xs text-gray-400 mt-1">团队公开 + 自己的私有卡片，发布后团队可见；文章草稿提交审核后进审核台</p>
            </div>
            {filter !== 'articles' && (
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 bg-cyber-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-cyber-blue-dark">
                <Plus className="w-4 h-4" /> 新增卡片
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {FILTER_TABS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`text-xs rounded-full px-3 py-1 transition-colors ${
                  filter === k ? 'bg-cyber-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {submitMsg && (
            <div className="text-xs text-cyber-blue bg-cyber-blue/5 border border-cyber-blue/20 rounded-lg px-3 py-2">{submitMsg}</div>
          )}

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <LayoutGrid className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">{filter === 'articles' ? '还没有文章草稿' : '还没有卡片'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(i => filter === 'articles' ? (
                <div key={i.id} onClick={() => openDetail(i.id)}
                  className={`${cardCls(i.id)} cursor-pointer`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{i.title}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-violet-50 text-violet-600">文章草稿</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-[11px] text-gray-400">{fmtTime(i.created_at)}</p>
                    <button onClick={e => { e.stopPropagation(); handleSubmit(i) }}
                      className="flex items-center gap-1 text-[11px] bg-cyber-blue text-white rounded-md px-2.5 py-1 font-semibold hover:bg-cyber-blue-dark">
                      <Send className="w-3 h-3" /> 提交审核
                    </button>
                  </div>
                </div>
              ) : (
                <button key={i.id} onClick={() => openDetail(i.id)} className={cardCls(i.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{i.title}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                      i.scope === 'team' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {i.scope === 'team' ? '团队' : '仅自己可见'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5 line-clamp-3 whitespace-pre-wrap">{i.content_md}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail side panel */}
      {selected && (
        <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto p-5 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">{selected.title}</h2>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-1.5 mt-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${selected.scope === 'team' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {selected.scope === 'team' ? '团队' : '仅自己可见'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{selected.form}</span>
          </div>
          <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">{selected.content_md}</div>
          {selected.links && selected.links.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                <Eye className="w-3 h-3" /> 引用链接
              </div>
              <ul className="mt-2 space-y-1">
                {selected.links.map((l, idx) => (
                  <li key={idx} className="text-xs text-cyber-blue">{l.direction === 'in' ? '被引用 ← ' : '引用 → '}{l.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[480px] space-y-3">
            <h2 className="text-sm font-bold text-gray-900">新增卡片</h2>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="卡片内容"
              rows={5}
              className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={toTeam} onChange={e => setToTeam(e.target.checked)} className="accent-cyber-blue" />
              直接发布到团队（免审）
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="text-xs text-gray-400 px-3 py-2 hover:text-gray-600">取消</button>
              <button onClick={handleCreate} disabled={submitting || !title.trim() || !content.trim()}
                className="bg-cyber-blue text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
                {submitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
