import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { AnswerActions } from '@/components/qa/AnswerActions'
import { CodeTraceCard } from '@/components/qa/CodeTraceCard'

interface Message {
  role: 'user' | 'assistant' | 'error'
  content: string
}

interface Session {
  sessionId: string
  question: string
  messages: Message[]
  streamingAnswer: string
  isStreaming: boolean
  feedback?: 'accepted' | 'rejected' | null
  rootQid?: number
  /** 后端 session_id，用于多轮追问分组 */
  backendSessionId?: string
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
  // 标记刚通过流式完成的 qid，URL effect 看到后跳过重复加载
  const streamCompleteQidRef = useRef<number | null>(null)

  // ── Backend data ────────────────────────────────────────
  const [sessionList, setSessionList] = useState<{session_id: string; root_qid: number; root_question: string; created_at: string; message_count: number; topic_slug?: string}[]>([])
  const [relatedQuestions, setRelatedQuestions] = useState<{qid: number; question: string; status: string}[]>([])
  const [sourceRefs, setSourceRefs] = useState<{file: string; line: string; snippet: string}[]>([])
  const [activeRootQid, setActiveRootQid] = useState<number | null>(null)
  // 历史加载的错误状态
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

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

  const createSession = useCallback((question: string, rootQid?: number): Session => {
    return {
      sessionId: genSessionId(),
      question,
      messages: [],
      streamingAnswer: '',
      isStreaming: false,
      rootQid,
    }
  }, [])

  // ── SSE 解析工具函数 ────────────────────────────────────
  const parseSSELine = useCallback((line: string, sid: string) => {
    const t = line.trim()
    if (!t || !t.startsWith('data: ')) return null
    try {
      return JSON.parse(t.slice(6)) as { type: string; content?: string; message?: string; qid?: number; session_id?: string; sources?: {file: string; line: string; snippet: string}[] }
    } catch {
      return null
    }
  }, [])

  // 处理 SSE 事件，返回 streamDone / streamError
  const handleSSEEvent = useCallback((msg: { type: string; content?: string; message?: string; qid?: number; session_id?: string; sources?: {file: string; line: string; snippet: string}[] }, sid: string): 'streamDone' | 'streamError' | 'continue' => {
    if (msg.type === 'meta' && msg.qid) {
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return { ...prev, [sid]: { ...s, rootQid: msg.qid, backendSessionId: msg.session_id || s.backendSessionId } }
      })
      return 'continue'
    }
    if (msg.type === 'token' && msg.content) {
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return { ...prev, [sid]: { ...s, streamingAnswer: (s.streamingAnswer || '') + msg.content } }
      })
      return 'continue'
    }
    if (msg.type === 'sources' && msg.sources) {
      setSourceRefs(msg.sources)
      return 'continue'
    }
    if (msg.type === 'error') {
      const errMsg = msg.message || '未知错误'
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return {
          ...prev,
          [sid]: {
            ...s,
            isStreaming: false,
            streamingAnswer: '',
            messages: [...s.messages, { role: 'error' as const, content: `❌ ${errMsg}` }],
          },
        }
      })
      return 'streamError'
    }
    if (msg.type === 'done') {
      // 流式结束 - 将 streamingAnswer 转为正式消息
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        const final = s.streamingAnswer || ''
        return {
          ...prev,
          [sid]: {
            ...s,
            messages: final ? [...s.messages, { role: 'assistant' as const, content: final }] : s.messages,
            streamingAnswer: '',
            isStreaming: false,
          },
        }
      })
      return 'streamDone'
    }
    return 'continue'
  }, [])

  // 从 ReadableStream 读取 SSE 并处理
  const consumeSSEStream = useCallback(async (reader: ReadableStreamDefaultReader<Uint8Array>, sid: string): Promise<{ qid: number | null }> => {
    const decoder = new TextDecoder()
    let buf = ''
    let qid: number | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          const msg = parseSSELine(line, sid)
          if (!msg) continue
          if (msg.type === 'meta' && msg.qid) {
            qid = msg.qid
          }
          const result = handleSSEEvent(msg, sid)
          if (result === 'streamDone') {
            return { qid }
          }
        }
      }
      // reader done 但没有收到 done 事件 — 可能是连接中断
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        if (s.isStreaming && !s.streamingAnswer) {
          return { ...prev, [sid]: { ...s, isStreaming: false, messages: [...s.messages, { role: 'error' as const, content: '❌ 连接中断，请重试' }] } }
        }
        return prev
      })
    } catch {
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return { ...prev, [sid]: { ...s, isStreaming: false, streamingAnswer: '' } }
      })
    }
    return { qid }
  }, [parseSSELine, handleSSEEvent])

  const activeSession = activeSessionId ? sessions[activeSessionId] : null

  // ── 提交问题（新问题 or 追问）：POST /api/qa → 直接消费 SSE ──
  const submitQuestion = useCallback(async (question: string) => {
    if (!question.trim() || loading) return
    setLoading(true)
    setLoadError(null)

    const isFollowUp = activeSession && activeSession.backendSessionId && activeSession.messages.length > 0

    let sid: string
    let backendSid: string
    let historyMessages: { role: string; content: string }[] | undefined

    const userMsg: Message = { role: 'user', content: question }

    if (isFollowUp) {
      // 追问：复用当前 session 和 backend session_id
      sid = activeSession!.sessionId
      backendSid = activeSession!.backendSessionId!
      historyMessages = activeSession!.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }))
      // 追加用户消息，开启流式
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return { ...prev, [sid]: { ...s, messages: [...s.messages, userMsg], streamingAnswer: '', isStreaming: true } }
      })
    } else {
      // 新问题：创建新 session
      const session = createSession(question)
      sid = session.sessionId
      backendSid = sid  // 新 session，用本地 UUID 作为后端 session_id
      setSessions(prev => ({
        ...prev,
        [sid]: { ...session, messages: [userMsg], streamingAnswer: '', isStreaming: true },
      }))
      setActiveSessionId(sid)
    }

    let resolvedQid: number | null = null

    try {
      const body: Record<string, unknown> = { question, sessionId: backendSid }
      if (historyMessages && historyMessages.length > 0) {
        body.messages = historyMessages
      }
      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        setSessions(prev => {
          const s = prev[sid]
          if (!s) return prev
          return { ...prev, [sid]: { ...s, isStreaming: false, messages: [...s.messages, { role: 'error' as const, content: `❌ 请求失败 (HTTP ${res.status})` }] } }
        })
        setLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const result = await consumeSSEStream(reader, sid)
      resolvedQid = result.qid
    } catch {
      setSessions(prev => {
        const s = prev[sid]
        if (!s) return prev
        return { ...prev, [sid]: { ...s, isStreaming: false, messages: [...s.messages, { role: 'error' as const, content: '❌ 网络错误，请重试' }] } }
      })
    }

    setLoading(false)
    if (resolvedQid) {
      streamCompleteQidRef.current = resolvedQid
      navigate(`/qa/q${resolvedQid}`, { replace: true })
    }
  }, [loading, activeSession, createSession, navigate, consumeSSEStream])

  const handleFeedback = useCallback((sessionId: string, _msgIndex: number, type: 'accepted' | 'rejected') => {
    setSessions(prev => {
      const s = prev[sessionId]
      if (!s) return prev
      return { ...prev, [sessionId]: { ...s, feedback: type } }
    })
  }, [])

  // Auto-scroll to bottom
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

  // ── URL 变化：加载历史会话 ──────────────────────────────
  useEffect(() => {
    const match = location.pathname.match(/^\/qa\/q(\d+)$/)
    if (!match) {
      setActiveSessionId(null)
      setLoadError(null)
      return
    }
    const qid = parseInt(match[1], 10)

    // 刚通过 submitQuestion 流式完成的 qid，跳过重复加载
    if (streamCompleteQidRef.current === qid) {
      streamCompleteQidRef.current = null
      // 更新 session 的 rootQid（submitQuestion 中 meta 事件已设置，这里保底）
      if (activeSessionId) {
        setSessions(prev => {
          const s = prev[activeSessionId]
          if (!s || s.rootQid === qid) return prev
          return { ...prev, [activeSessionId]: { ...s, rootQid: qid } }
        })
      }
      // 刷新 session list（后端已更新）
      fetchSessionList()
      return
    }

    // 历史问答 — 有加载状态
    setLoadError(null)
    const abortCtrl = new AbortController()

    ;(async () => {
      try {
        // 一次请求拿 entry + session 全部消息，避免两次顺序请求
        const entryRes = await fetch(`/api/qa/entry/${qid}?with_session=true`, { signal: abortCtrl.signal })
        if (!entryRes.ok) {
          setLoadError(`加载失败 (HTTP ${entryRes.status})`)
          return
        }
        const entryData = await entryRes.json()
        if (!entryData.ok || !entryData.data) {
          setLoadError('未找到该问答')
          return
        }
        const entry = entryData.data
        const sessionMessages: any[] | undefined = entryData.data.session_messages

        let messages: { role: 'user' | 'assistant'; content: string; sources?: {file: string; line: string; snippet: string}[] }[] = []
        let rootQid = qid
        let allSources: {file: string; line: string; snippet: string}[] = []

        if (sessionMessages && sessionMessages.length > 0) {
          // 用 session 全部消息构建完整对话
          rootQid = sessionMessages[0].qid
          for (const m of sessionMessages) {
            messages.push({ role: 'user', content: m.question || '' })
            if (m.answer) {
              messages.push({ role: 'assistant', content: m.answer, sources: m.sources })
            }
            if (m.sources?.length) allSources = m.sources
          }
        } else {
          // 退化为单条
          const question = entry.question || ''
          messages.push({ role: 'user' as const, content: question })
          if (entry.answer) {
            messages.push({ role: 'assistant' as const, content: entry.answer, sources: entry.sources })
          }
          if (entry.sources?.length) allSources = entry.sources
        }

        const session = createSession(messages[0]?.content || '', rootQid)
        const sid = session.sessionId
        setSessions(prev => ({
          ...prev,
          [sid]: {
            ...session,
            messages: messages as Message[],
            streamingAnswer: '',
            isStreaming: false,
            backendSessionId: entry.session_id || undefined,
            rootQid,
          },
        }))
        setActiveSessionId(sid)
        if (allSources.length > 0) setSourceRefs(allSources)
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setLoadError('网络错误，请检查后端是否运行')
      }
    })()

    return () => abortCtrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // ── 重试 pending 条目（手动触发流式） ────────────────────
  const retryStream = useCallback(async (qid: number, sessionId: string, question: string) => {
    setSessions(prev => {
      const s = prev[sessionId]
      if (!s) return prev
      return { ...prev, [sessionId]: { ...s, isStreaming: true, streamingAnswer: '' } }
    })

    try {
      const resp = await fetch(`/api/qa/stream/${qid}`)
      if (!resp.ok) {
        setSessions(prev => {
          const s = prev[sessionId]
          if (!s) return prev
          return { ...prev, [sessionId]: { ...s, isStreaming: false, messages: [...s.messages, { role: 'error' as const, content: `❌ 重试失败 (HTTP ${resp.status})` }] } }
        })
        return
      }
      const reader = resp.body!.getReader()
      await consumeSSEStream(reader, sessionId)
      // 成功的流式完成后刷新 session 列表
      fetchSessionList()
    } catch {
      setSessions(prev => {
        const s = prev[sessionId]
        if (!s) return prev
        return { ...prev, [sessionId]: { ...s, isStreaming: false, messages: [...s.messages, { role: 'error' as const, content: '❌ 网络错误，请重试' }] } }
      })
    }
  }, [consumeSSEStream, fetchSessionList])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 bg-white relative">

          {/* Message area */}
          <div ref={messageAreaRef} className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar pb-28">
            {!activeSession && !loadError && (
              <div className="text-center text-gray-400 py-20">
                <h2 className="text-lg font-bold text-gray-700 mb-2">对代码和文档提问</h2>
                <p className="text-sm">我可以帮你理解代码架构、检索文档或解释工作原理</p>
              </div>
            )}

            {/* 加载错误 */}
            {loadError && (
              <div className="max-w-3xl mx-auto py-20 text-center">
                <div className="inline-flex items-center gap-2 text-red-500 bg-red-50 px-4 py-3 rounded-lg">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">{loadError}</span>
                  <button
                    className="ml-2 text-red-600 hover:text-red-700 underline text-sm"
                    onClick={() => {
                      const match = location.pathname.match(/^\/qa\/q(\d+)$/)
                      if (match) {
                        setLoadError(null)
                        // 强制重新触发 effect：短暂切到 /qa 再切回来
                        navigate('/qa', { replace: true })
                        setTimeout(() => navigate(`/qa/q${match[1]}`, { replace: true }), 0)
                      }
                    }}
                  >
                    重试
                  </button>
                </div>
              </div>
            )}

            {activeSession && (() => {
              // 最后一条 assistant 消息始终显示按钮，其他仅 hover 显示
              const lastAssistantIdx = activeSession.messages.reduce(
                (acc, msg, idx) => (msg.role === 'assistant' ? idx : acc), -1,
              )
              return (
              <div className="max-w-3xl mx-auto space-y-8">
                {activeSession.messages.map((m, i) => (
                  <Fragment key={i}>
                    {i > 0 && <hr className="border-gray-100 my-2" />}
                    {m.role === 'user' ? (
                      <div className="flex justify-start">
                        <div className="bg-gray-100 text-gray-800 px-4 py-2.5 rounded-2xl rounded-bl-md max-w-[80%]">
                          <p className="text-sm">{m.content}</p>
                        </div>
                      </div>
                    ) : m.role === 'error' ? (
                      <div className="flex justify-center">
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{m.content}</span>
                          {activeSession.rootQid && (
                            <button
                              className="ml-2 inline-flex items-center gap-1 text-red-600 hover:text-red-700 underline"
                              onClick={() => retryStream(activeSession.rootQid!, activeSession!.sessionId, activeSession!.question)}
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> 重试
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="answer-block prose prose-sm max-w-none group">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        <AnswerActions
                          showOnHover={i !== lastAssistantIdx}
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

                {/* Code trace card */}
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

                {/* Pending 条目：显示重试按钮 */}
                {!activeSession.isStreaming &&
                  activeSession.messages.length === 1 &&
                  activeSession.messages[0].role === 'user' &&
                  activeSession.rootQid && (
                    <div className="flex justify-center py-4">
                      <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>该问题尚未生成回答</span>
                        <button
                          className="ml-2 inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 underline font-medium"
                          onClick={() => retryStream(activeSession.rootQid!, activeSession!.sessionId, activeSession!.question)}
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> 生成回答
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            )
            })()}
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
