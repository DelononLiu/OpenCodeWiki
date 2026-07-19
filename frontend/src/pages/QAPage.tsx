import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchQaEntries } from '@/api/client'
import type { QaEntry } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Plus, History, X } from 'lucide-react'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return '今天'
  if (days < 2) return '昨天'
  if (days < 7) return `${days}天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function groupByDate(entries: QaEntry[]): [string, QaEntry[]][] {
  const now = new Date()
  const groups: Record<string, QaEntry[]> = { '今天': [], '三天内': [], '本周': [], '本月': [], '更早': [] }
  entries.forEach(e => {
    const d = new Date(e.created_at)
    const days = (now.getTime() - d.getTime()) / 86400000
    if (days < 1) groups['今天'].push(e)
    else if (days < 3) groups['三天内'].push(e)
    else if (days < 7) groups['本周'].push(e)
    else if (days < 30) groups['本月'].push(e)
    else groups['更早'].push(e)
  })
  return Object.entries(groups).filter(([, list]) => list.length > 0)
}

export function QAPage() {
  const [qaEntries, setQaEntries] = useState<QaEntry[]>([])
  const [input, setInput] = useState('')
  const [expandedQid, setExpandedQid] = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [followups, setFollowups] = useState<Record<number, QaEntry[]>>({})
  const [newQuestionMode, setNewQuestionMode] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)).catch(() => {})
  }, [])

  const fetchFollowups = useCallback(async (qid: number) => {
    try {
      const res = await fetch(`/api/qa/entry/${qid}/followups`)
      const body = await res.json()
      if (body.ok) {
        setFollowups(prev => ({ ...prev, [qid]: body.data || [] }))
      }
    } catch { /* ignore */ }
  }, [])

  const refreshEntries = useCallback(async () => {
    try {
      const d = await fetchQaEntries({ limit: 100 })
      setQaEntries(d.entries)
    } catch { /* ignore */ }
  }, [])

  const handleToggleExpand = useCallback(async (qid: number) => {
    if (expandedQid === qid) {
      setExpandedQid(null)
      setInput('')
    } else {
      setExpandedQid(qid)
      setNewQuestionMode(false)
      setInput('')
      if (!followups[qid]) {
        await fetchFollowups(qid)
      }
    }
  }, [expandedQid, followups, fetchFollowups])

  const handleSaveQuestion = useCallback(async (q: string, parentQid?: number) => {
    if (!q.trim()) return
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        question: q.trim(),
        answer: '',
        repo: '',
      }
      if (parentQid) body.parent_qid = parentQid
      await fetch('/api/qa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setInput('')
      setNewQuestionMode(false)
      await refreshEntries()
      if (parentQid) {
        await fetchFollowups(parentQid)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [refreshEntries, fetchFollowups])

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q || loading) return
    // /new command: create a brand-new question, not a follow-up
    if (q.startsWith('/new ')) {
      const newQ = q.slice(5).trim()
      if (newQ) handleSaveQuestion(newQ)
      return
    }
    // With an expanded entry, save as follow-up; otherwise as a new question
    handleSaveQuestion(q, expandedQid ?? undefined)
  }, [input, loading, expandedQid, handleSaveQuestion])

  const handleNewQuestion = useCallback(() => {
    setNewQuestionMode(true)
    setExpandedQid(null)
    setInput('')
  }, [])

  const handleHistorySelect = useCallback((qid: number) => {
    setShowHistory(false)
    setExpandedQid(qid)
    setNewQuestionMode(false)
    setInput('')
    if (!followups[qid]) {
      fetchFollowups(qid)
    }
  }, [followups, fetchFollowups])

  const groupedHistory = groupByDate(qaEntries)

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      {/* Title row */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200/50">
        <h1 className="text-base font-bold text-gray-900">OpenCodeWiki 问答</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNewQuestion}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-cyber-blue hover:bg-cyber-blue/5 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" /> 新问题
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition"
          >
            <History className="w-3.5 h-3.5" /> 历史
          </button>
        </div>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* New-question mode: input card at top */}
          {newQuestionMode && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">创建新问题</h2>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="输入您的问题..."
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-cyber-blue focus:ring-1 focus:ring-cyber-blue/20"
                />
                <Button size="sm" onClick={handleSend} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '发送'}
                </Button>
              </div>
            </div>
          )}

          {/* Entry cards (accordion) */}
          {qaEntries.map(entry => {
            const isExpanded = expandedQid === entry.qid
            const entryFollowups = followups[entry.qid] || []

            return (
              <div
                key={entry.qid}
                className={`bg-white border rounded-xl shadow-sm transition-all ${
                  isExpanded
                    ? 'border-cyber-blue/30 ring-1 ring-cyber-blue/10'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Card header — clickable to expand / collapse */}
                <button
                  onClick={() => handleToggleExpand(entry.qid)}
                  className="w-full text-left p-4"
                >
                  <div className="flex items-center justify-between gap-4 mb-1">
                    <h3 className="text-sm font-semibold text-gray-900 truncate flex-1">
                      {entry.question}
                    </h3>
                    <div className="flex items-center gap-3 shrink-0">
                      {entry.visit_count > 0 && (
                        <span className="text-xs text-gray-400">🔥 {entry.visit_count}次</span>
                      )}
                      <span className="text-xs text-gray-400">{formatDate(entry.created_at)}</span>
                    </div>
                  </div>
                  {/* Preview snippet (collapsed state) */}
                  {!isExpanded && entry.answer && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {entry.answer.slice(0, 200)}{entry.answer.length > 200 ? '...' : ''}
                    </p>
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                    {/* Full answer */}
                    {entry.answer && (
                      <div className="text-sm text-gray-700">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer}</ReactMarkdown>
                      </div>
                    )}

                    {/* Follow-ups */}
                    {entryFollowups.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          ▶ {entryFollowups.length} 条追问
                        </h4>
                        <div className="space-y-2">
                          {entryFollowups.map(fu => (
                            <div key={fu.qid} className="border-l-2 border-gray-200 pl-3 py-1">
                              <p className="text-xs font-medium text-gray-800">{fu.question}</p>
                              {fu.answer && (
                                <div className="mt-1 text-xs text-gray-600">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fu.answer}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Follow-up input */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder="追问此问题... (/new 创建新问题)"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-cyber-blue focus:ring-1 focus:ring-cyber-blue/20"
                      />
                      <Button size="sm" onClick={handleSend} disabled={loading}>
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '发送'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Empty state */}
          {qaEntries.length === 0 && !newQuestionMode && (
            <div className="text-center text-gray-400 py-20">
              <h2 className="text-lg font-bold text-gray-700 mb-2">暂无问答记录</h2>
              <p className="text-sm">点击「+ 新问题」开始提问</p>
            </div>
          )}
        </div>
      </div>

      {/* History sidebar overlay */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-80 bg-white border-l border-gray-200 shadow-xl h-full overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">历史记录</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {groupedHistory.map(([label, list]) => (
                <div key={label}>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</h3>
                  <div className="space-y-1">
                    {list.map(qa => (
                      <button
                        key={qa.qid}
                        onClick={() => handleHistorySelect(qa.qid)}
                        className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition flex items-center justify-between gap-2"
                      >
                        <span className="text-gray-800 truncate flex-1">{qa.question}</span>
                        <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">#{qa.qid}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {groupedHistory.length === 0 && (
                <div className="text-center text-gray-400 text-xs py-8">暂无记录</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
