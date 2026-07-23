import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchKBs, fetchSession, askQuestion } from '@/api/opencodewiki'
import type { KB, QASource, StageInfo, ProcessSummary } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import ProcessPanel from '@/components/ProcessPanel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Send, Database, Plus, ChevronDown, ArrowDown } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: QASource[]
  thinking?: string
  thinkingDuration?: number
  totalTime?: number
  stages?: StageInfo[]
  summary?: ProcessSummary
}

/* ── Suggested Questions (empty-state cards) ── */
const SUGGESTED_QUESTIONS = [
  '这个项目是做什么的？',
  '代码架构是怎样的？',
  '如何快速上手开发？',
  '核心模块有哪些？',
]

/* ── Follow-up Suggestions (per answer) ── */
function FollowUpSuggestions({ suggestions, onSelect, loading }: {
  suggestions: string[]
  onSelect: (q: string) => void
  loading?: boolean
}) {
  if (!suggestions.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {loading && (
        <div className="w-full h-4 bg-gray-100 rounded animate-pulse" />
      )}
      {suggestions.map((q, i) => (
        <button key={i} onClick={() => onSelect(q)}
          className="text-xs text-gray-500 bg-gray-50 border border-gray-200/60 rounded-full px-3 py-1.5 hover:bg-gray-100 hover:text-gray-700 hover:border-gray-300 transition-colors whitespace-nowrap">
          {q}
        </button>
      ))}
    </div>
  )
}

/* ── Skeleton loading for messages ── */
function MessageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse px-1">
      <div className="flex justify-end">
        <div className="bg-gray-100 rounded-2xl rounded-br-md px-20 py-3 h-9 w-[45%]" />
      </div>
      <div className="space-y-2">
        <div className="bg-gray-100 rounded-lg h-4 w-[80%]" />
        <div className="bg-gray-100 rounded-lg h-4 w-full" />
        <div className="bg-gray-100 rounded-lg h-4 w-[60%]" />
      </div>
      <div className="flex justify-end mt-6">
        <div className="bg-gray-100 rounded-2xl rounded-br-md px-16 py-3 h-9 w-[35%]" />
      </div>
      <div className="space-y-2">
        <div className="bg-gray-100 rounded-lg h-4 w-[70%]" />
        <div className="bg-gray-100 rounded-lg h-4 w-[90%]" />
      </div>
    </div>
  )
}

export function QAPage() {
  const { sessionId: urlSessionId } = useParams()
  const navigate = useNavigate()
  const isNewChat = !urlSessionId

  const [kbs, setKbs] = useState<KB[]>([])
  const [selectedKB, setSelectedKB] = useState<string>('')
  const [activeSessionId, setActiveSessionId] = useState(urlSessionId || '')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingDone, setThinkingDone] = useState(false)
  const [streamingSources, setStreamingSources] = useState<QASource[]>([])
  const [pipelineStages, setPipelineStages] = useState<StageInfo[]>([])
  const [processSummary, setProcessSummary] = useState<ProcessSummary | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const messageAreaRef = useRef<HTMLDivElement>(null)
  const thinkStartRef = useRef(0)
  const submitTimeRef = useRef(0)
  const centerInputRef = useRef<HTMLInputElement>(null)
  const lastScrollTop = useRef(0)

  // ── Init ──
  useEffect(() => {
    fetchKBs().then(kbs => {
      setKbs(kbs)
      initSession(kbs)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initSession = async (loadedKbs: KB[]) => {
    if (urlSessionId) {
      setHistoryLoading(true)
      try {
        const session = await fetchSession(urlSessionId)
        if (session.messages?.length) {
          setMessages(session.messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            sources: m.sources ? JSON.parse(m.sources) : undefined,
            thinking: m.thinking || undefined,
          })))
        }
        if (session.kb_id) setSelectedKB(session.kb_id)
      } catch {
        navigate('/qa', { replace: true })
      } finally {
        setHistoryLoading(false)
      }
    } else {
      const storedKbId = localStorage.getItem('ocw_last_kb')
      if (storedKbId && loadedKbs.some(kb => kb.id === storedKbId)) {
        setSelectedKB(storedKbId)
      }
    }
  }

  // ── Track scroll ──
  const handleScroll = useCallback(() => {
    const el = messageAreaRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 80
    setUserScrolledUp(!isNearBottom)
    lastScrollTop.current = scrollTop
  }, [])

  const scrollToBottom = useCallback(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight
    }
    setUserScrolledUp(false)
  }, [])

  // ── Auto-scroll on new content ──
  useEffect(() => {
    if (!userScrolledUp && messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight
    }
  }, [messages, streamingText, userScrolledUp])

  // ── Send question ──
  const handleSubmit = async (text?: string, overrideKB?: string) => {
    const question = (text || input).trim()
    const kbId = overrideKB || selectedKB
    if (!question || streaming) return

    setError(null)
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setStreaming(true)
    setStreamingText('')
    setThinkingText('')
    setThinkingDone(false)
    setStreamingSources([])
    thinkStartRef.current = 0
    submitTimeRef.current = Date.now()
    setUserScrolledUp(false)

    try {
      const response = await askQuestion(kbId, question, activeSessionId)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''
      let sources: QASource[] = []
      let eventType = ''
      let localThinking = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            switch (eventType) {
              case 'stages':
                if (data.stages) setPipelineStages(data.stages)
                if (data.summary) setProcessSummary(data.summary)
                break
              case 'stage_start':
                setPipelineStages(prev => [...prev.filter(s => s.status !== 'running'), { name: data.name, status: 'running' }])
                break
              case 'stage_end':
                setPipelineStages(prev => prev.map(s =>
                  s.name === data.name ? { ...s, status: data.status || 'completed', duration_ms: data.duration_ms, detail: data.detail } : s
                ))
                break
              case 'session':
                if (data.session_id) {
                  setActiveSessionId(data.session_id)
                  window.history.replaceState(null, '', `/qa/${data.session_id}`)
                  if (kbId) localStorage.setItem('ocw_last_kb', kbId)
                }
                break
              case 'think':
                if (!thinkStartRef.current) thinkStartRef.current = Date.now()
                localThinking += data.text || ''
                setThinkingText(localThinking)
                break
              case 'token':
                if (!fullAnswer) setThinkingDone(true)
                fullAnswer += data.text || ''
                setStreamingText(fullAnswer)
                break
              case 'sources':
                sources = data
                setStreamingSources(data)
                break
              case 'done':
                setThinkingDone(true)
                break
              case 'error':
                setError(data.message)
                break
            }
            eventType = ''
          }
        }
      }

      if (fullAnswer) {
        const now = Date.now()
        const thinkSec = thinkStartRef.current
          ? Math.floor((now - thinkStartRef.current) / 1000) : 0
        const totalSec = submitTimeRef.current
          ? Math.floor((now - submitTimeRef.current) / 1000) : 0
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: fullAnswer,
          sources,
          thinking: localThinking,
          thinkingDuration: thinkSec,
          totalTime: totalSec,
          stages: pipelineStages,
          summary: processSummary,
        }])
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message || '请求失败')
    } finally {
      setStreaming(false)
      setStreamingText('')
      setStreamingSources([])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Follow-up suggestion click → send as new question
  const handleFollowUp = (q: string) => {
    setInput(q)
    // Auto-submit after a tick so the input state settles
    setTimeout(() => handleSubmit(q), 0)
  }

  const startNewChat = () => {
    navigate('/qa', { replace: true })
  }

  const handleKBChange = (kbId: string) => {
    if (!isNewChat) {
      if (kbId) localStorage.setItem('ocw_last_kb', kbId)
      navigate('/qa', { replace: true })
      return
    }
    setSelectedKB(kbId)
    setMessages([])
    setError(null)
    if (kbId) localStorage.setItem('ocw_last_kb', kbId)
  }

  const hasContent = messages.length > 0 || streaming || historyLoading

  // ── Shared input bar ──
  const renderInputBar = (compact = false) => (
    <div className={`flex gap-2.5 items-center ${compact ? '' : 'w-full'}`}>
      {/* New chat button */}
      {!compact && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-xl px-3 py-2.5 shrink-0 border-gray-200 text-gray-500 hover:bg-gray-100 hover:border-gray-300"
          onClick={startNewChat}
          title="新对话"
        >
          <Plus className="w-4 h-4" />
        </Button>
      )}

      {/* Input */}
      <div className="flex-1 relative">
        <input
          ref={!hasContent ? centerInputRef : undefined}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-50 border border-gray-200/80 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyber-blue/15 focus:border-cyber-blue/30 transition-all"
          style={{ padding: compact ? '10px 14px' : '10px 14px' }}
          placeholder={isNewChat ? '输入问题，Enter 发送...' : '继续提问...'}
          disabled={streaming}
        />
      </div>

      {/* Send */}
      <button
        onClick={() => handleSubmit()}
        disabled={streaming || !input.trim()}
        className="rounded-xl px-3.5 py-2.5 shrink-0 bg-cyber-blue text-white hover:bg-cyber-blue-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </div>
  )

  const isAssistant = (m: Message) => m.role === 'assistant'

  return (
    <div className="h-full flex flex-col relative">
      {/* ── Empty / Messages area ── */}
      <div ref={messageAreaRef} onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-4 md:px-8 ${hasContent ? '' : 'flex flex-col'}`}>
        {!hasContent ? (
          /* ═══════════════ Centered new-chat layout ═══════════════ */
          <div className="flex-1 flex flex-col items-center justify-center text-center select-none px-4">
            <div className="w-16 h-16 rounded-2xl bg-cyber-blue/10 flex items-center justify-center mb-5">
              <Database className="w-8 h-8 text-cyber-blue/60" />
            </div>
            <h2 className="text-xl font-semibold text-gray-700 mb-1.5">知识库问答</h2>
            <p className="text-sm text-gray-400 mb-8">输入问题开始对话，在侧栏选择知识库</p>

            {/* Suggested questions */}
            <div className="flex flex-wrap justify-center gap-2 max-w-lg mb-8">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => handleSubmit(q)}
                  className="px-4 py-2 rounded-xl text-sm text-gray-500 bg-white border border-gray-200/70 shadow-sm hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 transition-colors">
                  {q}
                </button>
              ))}
            </div>

            {/* Centered input box */}
            <div className="w-full max-w-2xl">
              <div className="bg-white border border-gray-200/80 rounded-2xl shadow-lg shadow-gray-200/50 p-2.5 transition-all duration-200 focus-within:border-cyber-blue/40 focus-within:shadow-xl focus-within:shadow-cyber-blue/5">
                {renderInputBar(true)}
              </div>
            </div>
          </div>
        ) : (
          /* ═══════════════ Messages ═══════════════ */
          <div className="max-w-3xl mx-auto py-6 space-y-5">
            {historyLoading ? (
              <MessageSkeleton />
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i}>
                    {m.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="bg-cyber-blue text-white px-4 py-2.5 rounded-2xl rounded-br-md max-w-[75%] shadow-sm">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <ProcessPanel
                          thinking={m.thinking || ''}
                          thinkingDone={true}
                          thinkingDuration={m.thinkingDuration || 0}
                          totalTime={m.totalTime || 0}
                          sources={m.sources || []}
                          stages={m.stages || []}
                          summary={m.summary}
                        />
                        <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-gray-800 prose-strong:text-gray-800 prose-code:text-cyber-blue prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                        {/* Follow-up suggestions on last message */}
                        {i === messages.length - 1 && isAssistant(m) && (
                          <FollowUpSuggestions
                            suggestions={[
                              '能详细解释一下关键部分吗？',
                              '这和竞品方案有什么区别？',
                              '有没有相关的代码示例？',
                            ]}
                            onSelect={handleFollowUp}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {streaming && (
              <>
                <ProcessPanel
                  thinking={thinkingText}
                  thinkingDone={thinkingDone}
                  thinkingDuration={thinkStartRef.current ? Math.floor((Date.now() - thinkStartRef.current) / 1000) : 0}
                  totalTime={submitTimeRef.current ? Math.floor((Date.now() - submitTimeRef.current) / 1000) : 0}
                  sources={streamingSources}
                  stages={pipelineStages}
                  summary={processSummary}
                />
                {streamingText ? (
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-gray-400 py-2 pl-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="text-xs text-gray-400 ml-1">思考中...</span>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Scroll-to-bottom button ── */}
      {hasContent && userScrolledUp && !streaming && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ bottom: '100px' }}>
          <button onClick={scrollToBottom}
            className="w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md flex items-center justify-center text-gray-500 hover:text-gray-700 hover:shadow-lg transition-all hover:-translate-y-0.5">
            <ArrowDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Bottom input bar ── */}
      {hasContent && (
        <div className="flex-shrink-0 border-t border-gray-200/70 bg-white/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-3.5">
            {renderInputBar(false)}
          </div>
        </div>
      )}
    </div>
  )
}
