import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import { useLayout } from '@/contexts/LayoutContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2,
  ThumbsUp, ThumbsDown, Copy, Share2, Check,
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
  const { setDrawerContent } = useLayout()
  // Fetch session history
  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

  // Feed drawer content (session history)
  useEffect(() => {
    setDrawerContent({
      title: '历史问答',
      items: sessionList.map(sl => ({
        id: sl.session_id,
        label: sl.root_question || '新对话',
        active: sl.session_id === activeSessionId,
        onClick: () => {
          if (sl.root_qid) loadSession(sl.session_id, sl.root_qid)
          setActiveSessionId(sl.session_id)
        },
      })),
    })
  }, [sessionList, activeSessionId])

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
    const isNewSession = !sessionId && !activeSessionId

    // Auto-abort after 120s timeout
    const timeoutId = setTimeout(() => {
      streamAbortedRef.current = true
      cancelStream()
    }, 120_000)

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

    clearTimeout(timeoutId)

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
      <div className="flex-1 flex overflow-hidden">

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 bg-white">


          {/* Message area */}
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
                        {activeRootQid && (
                          <button
                            className="p-1 hover:bg-slate-100 rounded hover:text-cyber-blue transition"
                            onClick={() => {
                              const url = `${window.location.origin}/qa/q/${activeRootQid}`
                              navigator.clipboard.writeText(url)
                            }}
                            title="复制分享链接"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
      </div>
    </div>
  )
}