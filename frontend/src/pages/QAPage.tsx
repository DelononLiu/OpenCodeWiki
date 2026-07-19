import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchQaEntries } from '@/api/client'
import type { QaEntry } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Plus, History, X } from 'lucide-react'
import { useSSE } from '@/hooks/useSSE'

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
  const [streamingQuestion, setStreamingQuestion] = useState('')
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const { stream, abort } = useSSE()
  const streamAbortedRef = useRef(false)
  const autoSubmitDoneRef = useRef(false) // prevent StrictMode double-fire at the source
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Data refresh ──────────────────────────────────────────

  useEffect(() => {
    fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)).catch(() => {})
  }, [])

  const refreshEntries = useCallback(async () => {
    try {
      const d = await fetchQaEntries({ limit: 100 })
      setQaEntries(d.entries)
    } catch { /* ignore */ }
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

  // ── Core submit: one session per conversation ─────────────

  const genSessionId = () => crypto.randomUUID()

  const submitQuestion = useCallback(async (question: string, opts?: {
    sessionId?: string          // reuse for follow-ups; generate new for root
    parentQuestion?: string     // ai context only
    parentAnswer?: string       // ai context only
    repo?: string
  }) => {
    if (!question.trim()) return

    // Explicitly passed sessionId takes priority (even empty string for legacy)
    // Only generate new UUID when sessionId is truly absent (undefined)
    const sessionId = opts?.sessionId !== undefined ? opts.sessionId : genSessionId()

    setLoading(true)
    setStreamingQuestion(question)
    setStreamingAnswer('')

    // AI context for follow-ups (does not affect data model)
    let context: Record<string, string> | undefined
    if (opts?.parentQuestion) {
      context = {
        parent_question: opts.parentQuestion,
        parent_answer: opts.parentAnswer || '',
      }
    }

    let collectedAnswer = ''
    await stream('/api/qa', {
      question,
      repo: opts?.repo || '',
      ...(context ? { context } : {}),
    }, (msg) => {
      if (msg.type === 'token' && msg.content) {
        collectedAnswer += msg.content as string
        setStreamingAnswer(collectedAnswer)
      }
    })

    if (streamAbortedRef.current) {
      streamAbortedRef.current = false
      setLoading(false)
      return
    }

    const isFollowup = !!opts?.parentQuestion
    try {
      const body: Record<string, unknown> = {
        question,
        answer: collectedAnswer || '(未生成回答)',
        repo: opts?.repo || '',
        session_id: sessionId,
      }
      const res = await fetch('/api/qa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setStreamingQuestion('')
      setStreamingAnswer('')
      setNewQuestionMode(false)
      await refreshEntries()
      if (isFollowup) {
        // refresh follow-ups under the parent entry
        const saved = await res.json()
        if (saved.ok && expandedQid) {
          await fetchFollowups(expandedQid)
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [stream, refreshEntries, fetchFollowups, expandedQid])

  // ── One-shot: consume ?q= / ?qid= from URL on mount ──────
  //     useRef gate ensures it runs exactly once, even under StrictMode

  useEffect(() => {
    if (autoSubmitDoneRef.current) return
    const q = searchParams.get('q')
    const qid = searchParams.get('qid')
    const contextTag = searchParams.get('context_entity_slug')

    if (q) {
      autoSubmitDoneRef.current = true
      // Wipe params before async submit to prevent any chance of re-trigger
      const clean = new URLSearchParams(searchParams)
      clean.delete('q')
      clean.delete('context_entity_slug')
      setSearchParams(clean, { replace: true })
      submitQuestion(q, { repo: contextTag || undefined })
    } else if (qid) {
      autoSubmitDoneRef.current = true
      const qidNum = parseInt(qid, 10)
      if (!isNaN(qidNum)) {
        const clean = new URLSearchParams(searchParams)
        clean.delete('qid')
        setSearchParams(clean, { replace: true })
        setExpandedQid(qidNum)
        setNewQuestionMode(false)
        if (!followups[qidNum]) {
          fetchFollowups(qidNum)
        }
        setTimeout(() => {
          document.getElementById(`qa-entry-${qidNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 200)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount-only; ref gate is the single-fire mechanism

  // ── Cancel stream ─────────────────────────────────────────

  const cancelStream = useCallback(() => {
    streamAbortedRef.current = true
    abort()
    setStreamingQuestion('')
    setStreamingAnswer('')
    setLoading(false)
  }, [abort])

  const handleToggleExpand = useCallback(async (qid: number) => {
    if (expandedQid === qid) {
      setExpandedQid(null)
      setInput('')
    } else {
      cancelStream()
      setExpandedQid(qid)
      setNewQuestionMode(false)
      setInput('')
      if (!followups[qid]) {
        await fetchFollowups(qid)
      }
    }
  }, [expandedQid, followups, fetchFollowups, cancelStream])

  const handleSend = useCallback(async () => {
    const q = input.trim()
    if (!q || loading) return

    // /new command: save without AI
    if (q.startsWith('/new ')) {
      const newQ = q.slice(5).trim()
      if (!newQ) return
      setLoading(true)
      try {
        await fetch('/api/qa/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: newQ, answer: '', repo: '' }),
        })
        setInput('')
        setNewQuestionMode(false)
        await refreshEntries()
      } finally {
        setLoading(false)
      }
      return
    }

    // Build follow-up context from expanded entry
    let sessionId: string | undefined
    let parentQuestion: string | undefined
    let parentAnswer: string | undefined
    if (expandedQid) {
      const parentEntry = qaEntries.find(e => e.qid === expandedQid)
      if (parentEntry) {
        sessionId = parentEntry.session_id
        parentQuestion = parentEntry.question
        parentAnswer = parentEntry.answer || ''
      }
    }

    setInput('')
    await submitQuestion(q, { sessionId, parentQuestion, parentAnswer })
  }, [input, loading, expandedQid, qaEntries, submitQuestion, refreshEntries])

  const handleNewQuestion = useCallback(() => {
    cancelStream()
    setNewQuestionMode(true)
    setExpandedQid(null)
    setInput('')
  }, [cancelStream])

  const handleHistorySelect = useCallback((qid: number) => {
    cancelStream()
    setShowHistory(false)
    setExpandedQid(qid)
    setNewQuestionMode(false)
    setInput('')
    if (!followups[qid]) {
      fetchFollowups(qid)
    }
    // 滚动到对应条目
    setTimeout(() => {
      document.getElementById(`qa-entry-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [followups, fetchFollowups, cancelStream])

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

          {/* Streaming answer card */}
          {streamingQuestion && (
            <div className="bg-white border border-cyber-blue/20 rounded-xl p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{streamingQuestion}</h3>
              <div className="text-sm text-gray-700">
                {streamingAnswer ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingAnswer}</ReactMarkdown>
                ) : (
                  <div className="flex items-center gap-2 text-gray-400 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Agent 思考中...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Entry cards (accordion) */}
          {qaEntries.map(entry => {
            const isExpanded = expandedQid === entry.qid
            const entryFollowups = followups[entry.qid] || []

            return (
              <div
                id={`qa-entry-${entry.qid}`}
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
