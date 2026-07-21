import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2 } from 'lucide-react'
import { AnswerActions } from '@/components/qa/AnswerActions'
import { CodeTraceCard } from '@/components/qa/CodeTraceCard'

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
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitDoneRef = useRef(false)
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

  const submitQuestion = useCallback(async (question: string) => {
    if (!question.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/qa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const d = await res.json()
      if (d.ok && d.data?.qid) {
        navigate(`/qa/q${d.data.qid}`, { replace: true })
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [navigate])

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

  // Auto-submit ?q= on first mount only
  useEffect(() => {
    if (autoSubmitDoneRef.current) return
    const q = searchParams.get('q')
    if (q) {
      autoSubmitDoneRef.current = true
      const clean = new URLSearchParams(searchParams)
      clean.delete('q')
      setSearchParams(clean, { replace: true })
      submitQuestion(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // URL 变化时：/qa/qN → 加载会话 + 连接流式，/qa → 清空
  useEffect(() => {
    const match = location.pathname.match(/^\/qa\/q(\d+)$/)
    if (!match) {
      setActiveSessionId(null)
      return
    }
    const qid = parseInt(match[1], 10)
    const sid = `session-${qid}`

    // 创建临时 session 并立即连接流式
    const session = createSession('')
    const sid_actual = session.sessionId
    setSessions(prev => ({ ...prev, [sid_actual]: { ...session, isStreaming: true } }))
    setActiveSessionId(sid_actual)

    // 连接 SSE 流式
    const abortCtrl = new AbortController()
    ;(async () => {
      try {
        const resp = await fetch(`/api/qa/stream/${qid}`, {
          signal: abortCtrl.signal,
        })
        const reader = resp.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            const t = line.trim()
            if (!t || !t.startsWith('data: ')) continue
            try {
              const msg = JSON.parse(t.slice(6))
              if (msg.type === 'token' && msg.content) {
                setSessions(prev => {
                  const s = prev[sid_actual]
                  if (!s) return prev
                  return { ...prev, [sid_actual]: { ...s, streamingAnswer: (s.streamingAnswer || '') + msg.content } }
                })
              } else if (msg.type === 'sources' && msg.sources) {
                setSourceRefs(msg.sources)
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* ignore abort */ }
      // 流式结束
      setSessions(prev => {
        const s = prev[sid_actual]
        if (!s) return prev
        return { ...prev, [sid_actual]: { ...s, isStreaming: false } }
      })
    })()

    return () => abortCtrl.abort()  // 清理
  }, [location.pathname])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 bg-white relative">


          {/* Message area */}
          <div ref={messageAreaRef} className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar pb-28">
            {!activeSession && (
              <div className="text-center text-gray-400 py-20">
                <h2 className="text-lg font-bold text-gray-700 mb-2">对代码和文档提问</h2>
                <p className="text-sm">我可以帮你理解代码架构、检索文档或解释工作原理</p>
              </div>
            )}

            {activeSession && (
              <div className="max-w-3xl mx-auto space-y-8">
                {activeSession.messages.map((m, i) => (
                  <Fragment key={i}>
                    {/* 轮次分隔线（除了第一个消息） */}
                    {i > 0 && <hr className="border-gray-100 my-2" />}
                    {m.role === 'user' ? (
                      <div className="flex justify-start">
                        <div className="bg-gray-100 text-gray-800 px-4 py-2.5 rounded-2xl rounded-bl-md max-w-[80%]">
                          <p className="text-sm">{m.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="answer-block prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        <AnswerActions
                          accepted={activeSession.feedback === 'accepted'}
                          rejected={activeSession.feedback === 'rejected'}
                          onAccept={() => handleFeedback(activeSession!.sessionId, i, 'accepted')}
                          onReject={() => handleFeedback(activeSession!.sessionId, i, 'rejected')}
                          onCopy={() => navigator.clipboard.writeText(m.content)}
                          onShare={() => {
                            const url = `${window.location.origin}/qa/q${activeRootQid}`
                            navigator.clipboard.writeText(url)
                          }}
                          rootQid={activeRootQid ?? undefined}
                          onPromoteTopic={(title) => {
                            console.log('Promote to topic:', title, activeRootQid)
                          }}
                        />
                      </div>
                    )}
                  </Fragment>
                ))}

                {/* Code trace card at the end of all messages */}
                {sourceRefs.length > 0 && <CodeTraceCard sourceRefs={sourceRefs} />}

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
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pointer-events-none p-3 z-10">
            <div className="w-full max-w-xl bg-white border border-gray-200 rounded-xl shadow-md p-2 flex items-center gap-2 pointer-events-auto">
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
                className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1.5 px-2"
                placeholder="输入你的问题..."
                data-qa-input
                disabled={loading}
              />
              <Button
                size="sm"
                className="bg-cyber-blue text-white rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0"
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