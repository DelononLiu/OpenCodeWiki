import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchKBs, fetchSession, askQuestion } from '@/api/opencodewiki'
import type { KB, QASource, StageInfo, ProcessSummary } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import ProcessPanel from '@/components/ProcessPanel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Send, Database, Plus, ChevronDown } from 'lucide-react'

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
  const messageAreaRef = useRef<HTMLDivElement>(null)
  const thinkStartRef = useRef(0)
  const submitTimeRef = useRef(0)

  // ── Init: fetch KBs, then load session or restore KB ──
  useEffect(() => {
    fetchKBs().then(kbs => {
      setKbs(kbs)
      initSession(kbs)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initSession = async (loadedKbs: KB[]) => {
    if (urlSessionId) {
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
        if (session.kb_id) {
          setSelectedKB(session.kb_id)
        }
      } catch {
        // Invalid session — redirect to new chat
        navigate('/qa', { replace: true })
      }
    } else {
      const storedKbId = localStorage.getItem('ocw_last_kb')
      if (storedKbId && loadedKbs.some(kb => kb.id === storedKbId)) {
        setSelectedKB(storedKbId)
      } else {
        setSelectedKB('')
      }
    }
  }

  // ── Auto-scroll ──
  useEffect(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight
    }
  }, [messages, streamingText])

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
                // Pipeline stages 1-4 completed (before LLM)
                if (data.stages) {
                  setPipelineStages(data.stages)
                }
                if (data.summary) {
                  setProcessSummary(data.summary)
                }
                break
              case 'stage_start':
                // A new stage begins (e.g. LLM推理)
                setPipelineStages(prev => [...prev.filter(s => s.status !== 'running'), { name: data.name, status: 'running' }])
                break
              case 'stage_end':
                setPipelineStages(prev => prev.map(s =>
                  s.name === data.name ? { ...s, status: data.status || 'completed', duration_ms: data.duration_ms, detail: data.detail } : s
                ))
                break
              case 'session':
                // 收到 session_id 立即更新 URL，不等回答流完
                if (data.session_id) {
                  setActiveSessionId(data.session_id)
                  window.history.replaceState(null, '', `/qa/${data.session_id}`)
                  if (kbId) {
                    localStorage.setItem('ocw_last_kb', kbId)
                  }
                }
                break
              case 'think':
                if (!thinkStartRef.current) {
                  thinkStartRef.current = Date.now()
                }
                localThinking += data.text || ''
                setThinkingText(localThinking)
                break
              case 'token':
                // 第一个 token 到达 → 思考结束
                if (!fullAnswer) {
                  setThinkingDone(true)
                }
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
          ? Math.floor((now - thinkStartRef.current) / 1000)
          : 0
        const totalSec = submitTimeRef.current
          ? Math.floor((now - submitTimeRef.current) / 1000)
          : 0
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
      if (e.name !== 'AbortError') {
        setError(e.message || '请求失败')
      }
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

  const startNewChat = () => {
    navigate('/qa', { replace: true })
  }

  const handleKBChange = (kbId: string) => {
    if (!isNewChat) {
      // On existing session: start a new chat with this KB
      if (kbId) {
        localStorage.setItem('ocw_last_kb', kbId)
      }
      navigate('/qa', { replace: true })
      return
    }
    // On new chat page: switch KB directly
    setSelectedKB(kbId)
    setMessages([])
    setError(null)
    if (kbId) {
      localStorage.setItem('ocw_last_kb', kbId)
    }
  }

  const currentKbLabel = kbs.find(kb => kb.id === selectedKB)?.name || '全部知识库'
  const [kbSelectOpen, setKbSelectOpen] = useState(false)

  return (
    <div className="h-full flex flex-col">
      {/* Message area */}
      <div ref={messageAreaRef} className="flex-1 overflow-y-auto px-4 md:px-8">
        {messages.length === 0 && !streaming ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-full text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-cyber-blue/10 flex items-center justify-center mb-5">
              <Database className="w-8 h-8 text-cyber-blue/60" />
            </div>
            <h2 className="text-xl font-semibold text-gray-700 mb-1.5">知识库问答</h2>
            <p className="text-sm text-gray-400 mb-8">选择知识库，输入问题开始对话</p>

            {/* KB quick pick cards */}
            {kbs.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {kbs.slice(0, 6).map(kb => (
                  <button key={kb.id} onClick={() => handleKBChange(kb.id)}
                    className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                      selectedKB === kb.id
                        ? 'bg-cyber-blue/15 text-cyber-blue border border-cyber-blue/20'
                        : 'bg-gray-100 text-gray-600 border border-gray-200/60 hover:bg-gray-200/60 hover:text-gray-800'
                    }`}>
                    {kb.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Messages ── */
          <div className="max-w-3xl mx-auto py-6 space-y-5">
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
                    {/* Process panel: thinking + sources in one foldable */}
                    <ProcessPanel
                      thinking={m.thinking || ''}
                      thinkingDone={true}
                      thinkingDuration={m.thinkingDuration || 0}
                      totalTime={m.totalTime || 0}
                      sources={m.sources || []}
                      stages={m.stages || []}
                      summary={m.summary}
                    />
                    {/* Answer content */}
                    <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-gray-800 prose-strong:text-gray-800 prose-code:text-cyber-blue prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Streaming card */}
            {streaming && (
              <>
                {/* Process panel during streaming */}
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
                  <div className="flex items-center gap-1.5 text-gray-400 py-2">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom input ── */}
      <div className="flex-shrink-0 border-t border-gray-200/70 bg-white/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-3.5 flex gap-2.5 items-center">
          {/* New chat button */}
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl px-3 py-2 shrink-0 border-gray-200 text-gray-500 hover:bg-gray-100 hover:border-gray-300"
            onClick={startNewChat}
            title="新对话"
          >
            <Plus className="w-4 h-4" />
          </Button>

          {/* KB selector */}
          <div className="relative shrink-0">
            <button onClick={() => setKbSelectOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200/70 border border-gray-200/60 rounded-lg px-2.5 py-2 transition-colors min-w-[90px]">
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[80px]">{currentKbLabel}</span>
              <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${kbSelectOpen ? 'rotate-180' : ''}`} />
            </button>
            {kbSelectOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg shadow-black/5 py-1 z-40 min-w-[140px]"
                onMouseLeave={() => setKbSelectOpen(false)}>
                <button onClick={() => { handleKBChange(''); setKbSelectOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    selectedKB === '' ? 'text-cyber-blue bg-cyber-blue/5 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  全部知识库
                </button>
                {kbs.map(kb => (
                  <button key={kb.id} onClick={() => { handleKBChange(kb.id); setKbSelectOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      selectedKB === kb.id ? 'text-cyber-blue bg-cyber-blue/5 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    {kb.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-gray-50 border border-gray-200/80 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyber-blue/15 focus:border-cyber-blue/30 py-2.5 px-3.5 transition-all"
              placeholder={isNewChat ? '输入问题，Enter 发送...' : '继续提问...'}
              disabled={streaming}
            />
          </div>

          {/* Send button */}
          <Button
            size="sm"
            className="rounded-xl px-3.5 py-2.5 shrink-0 bg-cyber-blue text-white hover:bg-cyber-blue-dark transition-colors disabled:opacity-40"
            onClick={() => handleSubmit()}
            disabled={streaming || !input.trim()}
          >
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
