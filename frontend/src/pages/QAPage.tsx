import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2, Sidebar, PanelRight, Plus,
  ThumbsUp, ThumbsDown, Copy,
  Hash, HelpCircle, Clock, Check, ChevronDown,
} from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  sessionId: string
  question: string
  messages: Message[]
  streamingAnswer: string
  isStreaming: boolean
  feedback?: 'accepted' | 'rejected' | null
}

function genSessionId(): string {
  return crypto.randomUUID()
}

export function QAPage() {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const { stream, abort } = useSSE()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitDoneRef = useRef(false)
  const streamAbortedRef = useRef(false)
  const messageAreaRef = useRef<HTMLDivElement>(null)

  // ── Backend data ────────────────────────────────────────
  const [sessionList, setSessionList] = useState<{session_id: string; root_qid: number; root_question: string; created_at: string; message_count: number; topic_slug?: string}[]>([])
  const [relatedQuestions, setRelatedQuestions] = useState<{qid: number; question: string; status: string}[]>([])
  const [sourceRefs, setSourceRefs] = useState<{file: string; line: string; snippet: string}[]>([])
  const [activeRootQid, setActiveRootQid] = useState<number | null>(null)

  // Fetch session history
  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

  // When active session changes, look up root_qid and fetch related + sources
  useEffect(() => {
    if (!activeSessionId) {
      setActiveRootQid(null)
      setRelatedQuestions([])
      setSourceRefs([])
      return
    }
    const info = sessionList.find(s => s.session_id === activeSessionId)
    const rootQid = info?.root_qid
    setActiveRootQid(rootQid || null)

    if (rootQid) {
      fetch(`/api/qa/entry/${rootQid}/related`).then(r => r.json()).then(d => {
        if (d.ok) setRelatedQuestions(d.data.related || [])
      }).catch(() => {})
      fetch(`/api/qa/entry/${rootQid}/sources`).then(r => r.json()).then(d => {
        if (d.ok) setSourceRefs(d.data.sources || [])
      }).catch(() => {})
    } else {
      setRelatedQuestions([])
      setSourceRefs([])
    }
  }, [activeSessionId, sessionList])

  const createSession = useCallback((question: string): Session => {
    return {
      sessionId: genSessionId(),
      question,
      messages: [],
      streamingAnswer: '',
      isStreaming: false,
    }
  }, [])

  const cancelStream = useCallback(() => {
    streamAbortedRef.current = true
    abort()
  }, [abort])

  const submitQuestion = useCallback(async (question: string, sessionId?: string) => {
    if (!question.trim()) return
    setLoading(true)

    // Determine or create session
    let sid = sessionId || activeSessionId
    let session: Session
    if (sid && sessions[sid]) {
      session = sessions[sid]
    } else {
      session = createSession(question)
      sid = session.sessionId
      setSessions(prev => ({ ...prev, [sid!]: session }))
    }

    // Add user message
    const userMsg: Message = { role: 'user', content: question }
    const updatedMessages = [...session.messages, userMsg]

    setSessions(prev => ({
      ...prev,
      [sid!]: {
        ...prev[sid!],
        messages: updatedMessages,
        isStreaming: true,
        streamingAnswer: '',
      },
    }))
    setActiveSessionId(sid!)

    let collectedAnswer = ''
    let collectedSources: any[] = []
    let errorMsg = ''
    streamAbortedRef.current = false

    // Pass message history for multi-turn context
    const history = isNewSession ? [] : session.messages
    await stream('/api/qa', { question, messages: history }, (msg) => {
      if (msg.type === 'token' && msg.content) {
        collectedAnswer += msg.content as string
        setSessions(prev => ({
          ...prev,
          [sid!]: {
            ...prev[sid!],
            streamingAnswer: collectedAnswer,
          },
        }))
      } else if (msg.type === 'sources' && msg.sources) {
        collectedSources = msg.sources as any[]
        setSourceRefs(collectedSources)
      } else if (msg.type === 'error' && msg.message) {
        errorMsg = msg.message as string
      }
    })

    if (streamAbortedRef.current) {
      setSessions(prev => {
        const s = prev[sid!]
        if (!s) return prev
        return { ...prev, [sid!]: { ...s, isStreaming: false } }
      })
      setLoading(false)
      return
    }

    // Stream complete — add assistant message
    const assistantMsg: Message = {
      role: 'assistant',
      content: collectedAnswer || (errorMsg ? `> ⚠️ ${errorMsg}` : ''),
    }

    setSessions(prev => ({
      ...prev,
      [sid!]: {
        ...prev[sid!],
        messages: [...prev[sid!].messages, assistantMsg],
        streamingAnswer: '',
        isStreaming: false,
      },
    }))

    // Persist to backend
    const isNewSession = !sessionId && !activeSessionId
    try {
      await fetch('/api/qa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          answer: collectedAnswer || '',
          repo: '',
          session_id: sid,
          session_create: isNewSession,
          sources: collectedSources,
        }),
      })
      // Refresh session list so left panel shows updated history
      fetchSessionList()
    } catch { /* ignore */ }

    setLoading(false)
  }, [activeSessionId, sessions, stream, createSession, fetchSessionList])

  const handleFeedback = useCallback((sessionId: string, _msgIndex: number, type: 'accepted' | 'rejected') => {
    setSessions(prev => {
      const s = prev[sessionId]
      if (!s) return prev
      return { ...prev, [sessionId]: { ...s, feedback: type } }
    })
    if (type === 'rejected') {
      setRightPanelOpen(true)
    }
  }, [])

  const activeSession = activeSessionId ? sessions[activeSessionId] : null

  // Auto-scroll to bottom when messages or streaming answer update
  useEffect(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight
    }
  }, [activeSession?.messages, activeSession?.streamingAnswer])

  // Load a session from backend (for history clicks / ?qid= links)
  const loadSession = useCallback(async (sessionId: string, rootQid: number) => {
    if (sessions[sessionId]?.messages.length) return  // already loaded

    const [entryRes, fuRes] = await Promise.all([
      fetch(`/api/qa/entry/${rootQid}`),
      fetch(`/api/qa/entry/${rootQid}/followups`),
    ])
    const entry = await entryRes.json()
    const followups = await fuRes.json()

    if (!entry.ok) return

    const e = entry.data
    const msgs: Message[] = [
      { role: 'user', content: e.question },
      { role: 'assistant', content: e.answer || '' },
    ]
    if (followups.ok && followups.data) {
      for (const f of followups.data) {
        msgs.push({ role: 'user', content: f.question })
        if (f.answer) msgs.push({ role: 'assistant', content: f.answer })
      }
    }

    setSessions(prev => ({
      ...prev,
      [sessionId]: {
        sessionId,
        question: e.question,
        messages: msgs,
        streamingAnswer: '',
        isStreaming: false,
      },
    }))
  }, [sessions])

  // Auto-submit ?q= or load ?qid=
  useEffect(() => {
    if (autoSubmitDoneRef.current) return
    const q = searchParams.get('q')
    const qid = searchParams.get('qid')

    if (q) {
      autoSubmitDoneRef.current = true
      const clean = new URLSearchParams(searchParams)
      clean.delete('q')
      setSearchParams(clean, { replace: true })
      submitQuestion(q)
    } else if (qid) {
      const qidNum = parseInt(qid, 10)
      if (!isNaN(qidNum)) {
        autoSubmitDoneRef.current = true
        const clean = new URLSearchParams(searchParams)
        clean.delete('qid')
        setSearchParams(clean, { replace: true })
        // Find session from list, or load via entry API
        fetch(`/api/qa/entry/${qidNum}`).then(r => r.json()).then(d => {
          if (d.ok && d.data.session_id) {
            loadSession(d.data.session_id, qidNum)
            setActiveSessionId(d.data.session_id)
          }
        }).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      <div className="flex-1 flex overflow-hidden w-full px-4 py-3 gap-3">

        {/* Left Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: leftPanelOpen ? '16rem' : '0px', opacity: leftPanelOpen ? 1 : 0, padding: leftPanelOpen ? '1rem' : '0', borderWidth: leftPanelOpen ? '1px' : '0' }}
        >
          {leftPanelOpen && (
            <div className="space-y-5 text-xs flex flex-col">
              <button
                onClick={() => setLeftPanelOpen(false)}
                className="self-end p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700 transition"
              >
                <Sidebar className="w-3.5 h-3.5" />
              </button>
              {/* 关联主题 */}
              {(() => {
                const topicSlug = sessionList.find(s => s.session_id === activeSessionId)?.topic_slug
                return (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                      <Hash className="w-3.5 h-3.5 text-cyber-blue" />
                      关联主题
                    </h3>
                    <div className="px-2.5 py-1.5 rounded-lg bg-cyber-blue/5 border border-cyber-blue/20 text-cyber-blue font-mono font-bold text-[11px]">
                      {topicSlug ? `#${topicSlug}` : '—'}
                    </div>
                  </div>
                )
              })()}

              {/* 相关问题 */}
              <div className="pt-4 border-t border-gray-200/60">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 px-1 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5 text-cyber-blue" />
                  相关问题
                </h3>
                {relatedQuestions.length > 0 ? (
                  <ul className="space-y-2 text-[11px]">
                    {relatedQuestions.map(rq => (
                      <li key={rq.qid}>
                        <button
                          onClick={() => {
                            const info = sessionList.find(s => s.root_qid === rq.qid)
                            if (info) {
                              if (info.root_qid) loadSession(info.session_id, info.root_qid)
                              setActiveSessionId(info.session_id)
                            }
                          }}
                          className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1"
                        >
                          <span className="leading-snug">{rq.question}</span>
                          <span className={`text-[9px] px-1 py-0.5 rounded self-start font-bold ${rq.status === 'active' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-cyber-red/10 text-cyber-red'}`}>
                            {rq.status === 'active' ? '回答已采纳' : '待验证'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-gray-400 px-1">暂无相关问题</p>
                )}
              </div>

              {/* 历史对话 — collapsible */}
              <div className="pt-4 border-t border-gray-200/60">
                <button
                  onClick={() => setHistoryExpanded(prev => !prev)}
                  className="w-full flex items-center justify-between px-1"
                >
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    历史对话
                  </h3>
                  <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} />
                </button>
                {historyExpanded && (
                  <div className="mt-2 space-y-1">
                    {sessionList.length > 0 ? (
                      sessionList.map(sl => (
                        <button
                          key={sl.session_id}
                          onClick={() => {
                            if (sl.root_qid) loadSession(sl.session_id, sl.root_qid)
                            setActiveSessionId(sl.session_id)
                          }}
                          className={`w-full text-left p-2 rounded-lg font-mono text-[11px] flex justify-between items-center transition ${activeSessionId === sl.session_id ? 'bg-cyber-blue/10 text-cyber-blue' : 'bg-slate-100 text-gray-900 hover:bg-gray-200'}`}
                        >
                          <span className="truncate">{sl.root_question}</span>
                          <span className="text-[9px] text-gray-400 shrink-0 ml-1">{sl.message_count}</span>
                        </button>
                      ))
                    ) : (
                      <p className="text-[11px] text-gray-400 px-1">暂无对话</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Center Panel */}
        <main className="flex-1 bg-white border border-gray-200/50 shadow-sm rounded-xl flex flex-col overflow-hidden relative min-w-0">

          {/* Top bar */}
          <div className="p-3 border-b border-gray-100 bg-slate-50/30 flex items-center justify-between shrink-0 relative">
            <div className="flex items-center gap-2">
              {!leftPanelOpen && (
                <button
                  onClick={() => setLeftPanelOpen(true)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition"
                >
                  <Sidebar className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => {
                  setActiveSessionId(null)
                  setTimeout(() => {
                    const inp = document.querySelector<HTMLInputElement>('[data-qa-input]')
                    inp?.focus()
                  }, 50)
                }}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-cyber-blue transition"
                title="新问题"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
              {activeSession ? (
                <>
                  <span className="w-5 h-5 bg-cyber-blue/10 rounded-full flex items-center justify-center text-cyber-blue font-bold text-xs font-mono">Q</span>
                  <h2 className="text-xs font-bold text-gray-900 truncate max-w-md">{activeSession.question}</h2>
                </>
              ) : (
                <span className="text-xs text-gray-400">对代码库提问</span>
              )}
            </div>

            {!rightPanelOpen && (
              <button
                onClick={() => setRightPanelOpen(true)}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition"
              >
                <PanelRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Message area — document flow */}
          <div ref={messageAreaRef} className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar pb-28">
            {!activeSession && (
              <div className="text-center text-gray-400 py-20">
                <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                <p className="text-sm">我可以帮你理解架构、定位代码或解释工作原理</p>
              </div>
            )}

            {activeSession && (
              <div className="max-w-3xl mx-auto space-y-8">
                {activeSession.messages.map((m, i) => (
                  m.role === 'user' ? (
                    <h2 key={i} className="text-lg font-bold text-gray-900 border-b border-gray-200 pb-2">
                      {m.content}
                    </h2>
                  ) : (
                    <div key={i} className="answer-block prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>

                      {activeSession.feedback == null && (
                      <div className="action-bar flex items-center gap-1 text-gray-400 select-none mt-4 pt-3 border-t border-gray-100">
                        <button className="p-1 hover:bg-slate-100 rounded hover:text-cyber-green transition" onClick={() => handleFeedback(activeSession!.sessionId, i, 'accepted')} title="回答已采纳"><ThumbsUp className="w-3.5 h-3.5" /></button>
                        <button className="p-1 hover:bg-slate-100 rounded hover:text-cyber-red transition" onClick={() => handleFeedback(activeSession!.sessionId, i, 'rejected')} title="待验证"><ThumbsDown className="w-3.5 h-3.5" /></button>
                        <button className="p-1 hover:bg-slate-100 rounded hover:text-gray-700 transition" onClick={() => navigator.clipboard.writeText(m.content)}><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                      )}
                      {activeSession.feedback === 'accepted' && (
                        <span className="text-[10px] font-medium text-cyber-green flex items-center gap-1 mt-2"><Check className="w-3 h-3" /> 已收集反馈</span>
                      )}
                    </div>
                  )
                ))}

                {/* Streaming answer */}
                {activeSession.isStreaming && (
                  activeSession.streamingAnswer ? (
                    <div className="answer-block prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeSession.streamingAnswer}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-gray-400 py-2">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Bottom input */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pointer-events-none p-3 z-10">
            <div className="w-[80%] bg-white border border-gray-200 rounded-xl shadow-md p-2 flex items-center gap-2 pointer-events-auto">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !loading) {
                    submitQuestion(input)
                    setInput('')
                  }
                }}
                className="w-full bg-transparent border-none text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1 px-2"
                placeholder="在此继续追问..."
                data-qa-input
                disabled={loading}
              />
              <Button
                size="sm"
                className="bg-cyber-blue text-white rounded-lg px-4 py-1.5 text-xs font-semibold shrink-0"
                onClick={() => {
                  submitQuestion(input)
                  setInput('')
                }}
                disabled={loading || !input.trim()}
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '发送'}
              </Button>
            </div>
          </div>
        </main>

        {/* Right Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: rightPanelOpen ? '360px' : '0px', opacity: rightPanelOpen ? 1 : 0, padding: rightPanelOpen ? '1rem' : '0', borderWidth: rightPanelOpen ? '1px' : '0' }}
        >
          {rightPanelOpen && (
            <div className="space-y-4">
              <button
                onClick={() => setRightPanelOpen(false)}
                className="self-start p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700 transition"
              >
                <PanelRight className="w-3.5 h-3.5" />
              </button>
              {/* 参考引用 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-2">
                  <span>参考引用</span>
                </div>
                {sourceRefs.length > 0 ? (
                  sourceRefs.map((src, i) => (
                    <div key={i} className="mb-3">
                      <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                        <span>{src.file}</span>
                        <span>{src.line}</span>
                      </div>
                      <div className="bg-[#1E1E2F] rounded-xl text-[11px] text-slate-300 font-mono p-4">
                        <div className="text-white font-medium">{src.snippet}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-gray-400">暂无引用来源</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
