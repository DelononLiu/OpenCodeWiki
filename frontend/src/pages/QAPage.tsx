import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchKBs, fetchSession, askQuestion } from '@/api/opencodewiki'
import type { KB, QASource } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import ProcessPanel from '@/components/ProcessPanel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Send, FileText, Database, Plus } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: QASource[]
  thinking?: string
  thinkingDuration?: number
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
  const [error, setError] = useState<string | null>(null)
  const messageAreaRef = useRef<HTMLDivElement>(null)
  const thinkStartRef = useRef(0)

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
      } else if (loadedKbs.length > 0) {
        setSelectedKB(loadedKbs[0].id)
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
        const thinkSec = thinkStartRef.current
          ? Math.floor((Date.now() - thinkStartRef.current) / 1000)
          : 0
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: fullAnswer,
          sources,
          thinking: localThinking,
          thinkingDuration: thinkSec,
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

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Message area */}
      <div ref={messageAreaRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3">
            <Database className="w-10 h-10 text-gray-300" />
            <h2 className="text-lg font-bold text-gray-500">知识库问答</h2>
            <p className="text-sm">选择知识库，在下方输入问题</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
            {messages.map((m, i) => (
              <div key={i}>
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-gray-100 text-gray-800 px-4 py-2.5 rounded-2xl rounded-br-md max-w-[80%]">
                      <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Process panel: thinking + sources in one foldable */}
                    <ProcessPanel
                      thinking={m.thinking || ''}
                      thinkingDone={true}
                      thinkingDuration={m.thinkingDuration || 0}
                      sources={m.sources || []}
                    />
                    {/* Answer content */}
                    <div className="prose prose-sm max-w-none">
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
                  sources={streamingSources}
                />
                {streamingText ? (
                  <div className="prose prose-sm max-w-none">
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

      {/* Bottom input */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white">
        <div className="max-w-3xl mx-auto px-8 py-4 flex gap-2 items-center">
          <Button
            size="sm"
            variant="outline"
            className="text-xs rounded-lg px-2 py-2 shrink-0"
            onClick={startNewChat}
            title="新对话"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <select
            value={isNewChat ? selectedKB : (selectedKB || '')}
            onChange={e => handleKBChange(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 w-36"
          >
            <option value="">全部知识库</option>
            {kbs.map(kb => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 py-2 px-3"
            placeholder={isNewChat ? '输入问题，Enter 发送...' : '继续提问...'}
            disabled={streaming}
          />
          <Button
            size="sm"
            className="bg-cyber-blue text-white rounded-lg px-3 py-2 text-xs font-semibold shrink-0"
            onClick={() => handleSubmit()}
            disabled={streaming || !input.trim()}
          >
            {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
