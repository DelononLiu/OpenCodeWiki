import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchKBs, askQuestion } from '@/api/opencodewiki'
import type { KB, QASource } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Send, FileText, Database } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: QASource[]
}

export function QAPage() {
  const [kbs, setKbs] = useState<KB[]>([])
  const [selectedKB, setSelectedKB] = useState<string>('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingSources, setStreamingSources] = useState<QASource[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const messageAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchKBs().then(setKbs).catch(() => {}) }, [])

  // Auto-submit ?q= param
  useEffect(() => {
    const q = searchParams.get('q')
    if (q && kbs.length > 0 && !selectedKB) {
      setSelectedKB(kbs[0].id)
      handleSubmit(q, kbs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbs])

  // Auto-scroll
  useEffect(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight
    }
  }, [messages, streamingText])

  const handleSubmit = async (text?: string, overrideKB?: string) => {
    const question = (text || input).trim()
    const kbId = overrideKB || selectedKB
    if (!question || !kbId || streaming) return

    setError(null)
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setStreaming(true)
    setStreamingText('')
    setStreamingSources([])

    try {
      const response = await askQuestion(kbId, question)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''
      let sources: QASource[] = []
      let eventType = ''

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
              case 'token':
                fullAnswer += data.text || ''
                setStreamingText(fullAnswer)
                break
              case 'sources':
                sources = data
                setStreamingSources(data)
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
        setMessages(prev => [...prev, { role: 'assistant', content: fullAnswer, sources }])
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
                  <div className="space-y-3">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                    {m.sources && m.sources.length > 0 && (
                      <div className="border-t border-gray-100 pt-2 space-y-1">
                        {m.sources.map((s, j) => (
                          <div key={j} className="flex items-start gap-2 text-xs text-gray-500">
                            <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span className="font-medium flex-shrink-0">{s.doc_title}</span>
                            <span className="text-gray-400 truncate">{s.content.slice(0, 100)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Streaming */}
            {streaming && (
              <>
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
                {streamingSources.length > 0 && (
                  <div className="border-t border-gray-100 pt-2 space-y-1">
                    {streamingSources.map((s, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs text-gray-500">
                        <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span className="font-medium flex-shrink-0">{s.doc_title}</span>
                      </div>
                    ))}
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
          <select
            value={selectedKB}
            onChange={e => setSelectedKB(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 w-36"
          >
            <option value="">选择知识库</option>
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
            placeholder="输入问题，Enter 发送..."
            disabled={streaming}
          />
          <Button
            size="sm"
            className="bg-cyber-blue text-white rounded-lg px-3 py-2 text-xs font-semibold shrink-0"
            onClick={() => handleSubmit()}
            disabled={streaming || !input.trim() || !selectedKB}
          >
            {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
