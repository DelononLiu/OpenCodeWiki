import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2, Plus, ChevronLeft, ChevronRight,
  ThumbsUp, ThumbsDown, Copy, MoreHorizontal, X,
  Hash, HelpCircle, Clock, Check,
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
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const { stream, abort } = useSSE()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitDoneRef = useRef(false)
  const streamAbortedRef = useRef(false)

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
    streamAbortedRef.current = false

    await stream('/api/qa', { question }, (msg) => {
      if (msg.type === 'token' && msg.content) {
        collectedAnswer += msg.content as string
        setSessions(prev => ({
          ...prev,
          [sid!]: {
            ...prev[sid!],
            streamingAnswer: collectedAnswer,
          },
        }))
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
      content: collectedAnswer || '(未生成回答)',
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
          answer: collectedAnswer || '(未生成回答)',
          repo: '',
          session_id: sid,
        }),
      })
    } catch { /* ignore */ }

    setLoading(false)
  }, [activeSessionId, sessions, stream, createSession])

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

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      <div className="flex-1 flex overflow-hidden w-full px-4 py-3 gap-3">

        {/* Left Panel */}
        <div className="relative shrink-0">
          <aside
            className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
            style={{ width: leftPanelOpen ? '16rem' : '0px', opacity: leftPanelOpen ? 1 : 0, padding: leftPanelOpen ? '1rem' : '0', borderWidth: leftPanelOpen ? '1px' : '0' }}
          >
            {leftPanelOpen && (
              <div className="space-y-5 text-xs">
                {/* Panel header with close */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">面板</span>
                  <button
                    onClick={() => setLeftPanelOpen(false)}
                    className="p-0.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 关联主题 */}
              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-cyber-blue" />
                  关联主题
                </h3>
                <div className="px-2.5 py-1.5 rounded-lg bg-cyber-blue/5 border border-cyber-blue/20 text-cyber-blue font-mono font-bold text-[11px]">
                  #qa-engine
                </div>
              </div>

              {/* 相关问题 */}
              <div className="pt-4 border-t border-gray-200/60">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 px-1 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5 text-cyber-blue" />
                  相关问题
                </h3>
                <ul className="space-y-2 text-[11px]">
                  <li>
                    <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
                      <span className="leading-snug">异步加载后如何做预热保护避免空指针？</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-green/10 text-cyber-green self-start font-bold">回答已采纳</span>
                    </button>
                  </li>
                  <li>
                    <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
                      <span className="leading-snug">全量本地内存索引会引发 OOM 溢出吗？</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-red/10 text-cyber-red self-start font-bold">待验证</span>
                    </button>
                  </li>
                </ul>
              </div>

              {/* 历史对话 */}
              <div className="pt-4 border-t border-gray-200/60">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  历史对话
                </h3>
                <div className="bg-slate-100 text-gray-900 p-2 rounded-lg font-mono text-[11px] flex justify-between items-center">
                  <span className="truncate">LSH冷启动300ms停顿</span>
                </div>
              </div>
            </div>
          )}
        </aside>
        {!leftPanelOpen && (
          <button
            onClick={() => setLeftPanelOpen(true)}
            className="absolute top-3 -right-8 bg-white border border-gray-200 rounded-r-lg p-1.5 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-700 transition z-10"
            title="展开面板"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

        {/* Center Panel */}
        <main className="flex-1 bg-white border border-gray-200/50 shadow-sm rounded-xl flex flex-col overflow-hidden relative min-w-0">

          {/* Top bar */}
          <div className="p-3 border-b border-gray-100 bg-slate-50/30 flex items-center justify-center shrink-0 relative">
            <button
              onClick={() => {
                setActiveSessionId(null)
                setTimeout(() => {
                  const inp = document.querySelector<HTMLInputElement>('[data-qa-input]')
                  inp?.focus()
                }, 50)
              }}
              className="absolute left-3 p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-cyber-blue transition"
              title="新问题"
            >
              <Plus className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              {activeSession ? (
                <>
                  <span className="w-5 h-5 bg-cyber-blue/10 rounded-full flex items-center justify-center text-cyber-blue font-bold text-xs font-mono">Q</span>
                  <h2 className="text-xs font-bold text-gray-900 truncate max-w-md">{activeSession.question}</h2>
                </>
              ) : (
                <span className="text-xs text-gray-400">对代码库提问</span>
              )}
            </div>
          </div>

          {/* Message area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar pb-28">
            {!activeSession && (
              <div className="text-center text-gray-400 py-20">
                <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                <p className="text-sm">我可以帮你理解架构、定位代码或解释工作原理</p>
              </div>
            )}

            {activeSession && (
              <>
                {activeSession.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.role === 'user' ? (
                      <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-cyber-blue text-white">
                        {m.content}
                      </div>
                    ) : (
                      <div className="answer-block max-w-[85%] border border-transparent hover:border-slate-100/60 rounded-xl p-2 -mx-2 transition-all duration-200 space-y-4">
                        <div className="text-sm text-gray-700 leading-relaxed bg-slate-50/40 border border-gray-200 p-4 rounded-xl">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>

                        {/* Hover actions */}
                        {activeSession.feedback == null && (
                        <div className="action-bar flex items-center gap-1 text-gray-400 select-none pl-1 h-6">
                          <button
                            className="p-1 hover:bg-slate-100 rounded hover:text-cyber-green transition"
                            onClick={() => handleFeedback(activeSession!.sessionId, i, 'accepted')}
                            title="回答已采纳"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1 hover:bg-slate-100 rounded hover:text-cyber-red transition"
                            onClick={() => handleFeedback(activeSession!.sessionId, i, 'rejected')}
                            title="待验证"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1 hover:bg-slate-100 rounded hover:text-gray-700 transition"
                            onClick={() => navigator.clipboard.writeText(m.content)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1 hover:bg-slate-100 rounded hover:text-gray-700 transition">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        )}

                        {/* Feedback status */}
                        {activeSession.feedback === 'accepted' && (
                          <span className="text-[10px] font-medium text-cyber-green flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/50">
                            <Check className="w-3 h-3" /> 已收集反馈，谢谢您帮助提升质量
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Streaming answer (live or background) */}
                {activeSession.isStreaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl p-4 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">
                      {activeSession.streamingAnswer ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeSession.streamingAnswer}</ReactMarkdown>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-400 py-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Agent 思考中...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom input */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pointer-events-none p-3 z-10">
            <div className="w-full bg-white border border-gray-200 rounded-xl shadow-md p-2 flex items-center gap-2 pointer-events-auto">
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
        <div className="relative shrink-0">
          <aside
            className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
            style={{ width: rightPanelOpen ? '450px' : '0px', opacity: rightPanelOpen ? 1 : 0, padding: rightPanelOpen ? '1rem' : '0', borderWidth: rightPanelOpen ? '1px' : '0' }}
          >
            {rightPanelOpen && (
              <div className="space-y-4">
                {/* Panel header with close */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">源码引用</span>
                  <button
                    onClick={() => setRightPanelOpen(false)}
                    className="p-0.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 参考引用 */}
                <div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-2">
                    <span>参考引用</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                    <span>docs/02-qa-engine.md</span>
                    <span>L14 - L15</span>
                  </div>
                  <div className="bg-[#1E1E2F] rounded-xl text-[11px] text-slate-300 font-mono p-4">
                    <div className="text-white font-medium">
                      系统分流引擎在冷启动阶段加载索引时，必须严格采用异步非阻塞I/O
                    </div>
                  </div>
                </div>

                {/* 分隔线 */}
                <div className="border-t border-gray-100" />

                {/* 关联变更 */}
                <div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-2">
                    <span>关联变更</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                    <span>config/app.yml</span>
                    <span>L46</span>
                  </div>
                  <div className="bg-[#1E1E2F] rounded-xl text-[11px] text-slate-300 font-mono p-4">
                    <div className="text-cyber-orange font-medium">
                      bootstrap.timeout: 500
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>
          {!rightPanelOpen && (
            <button
              onClick={() => setRightPanelOpen(true)}
              className="absolute top-3 -left-8 bg-white border border-gray-200 rounded-l-lg p-1.5 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-700 transition z-10"
              title="展开源码引用"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
