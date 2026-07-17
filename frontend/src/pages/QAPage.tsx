import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function QAPage() {
  const [searchParams] = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(searchParams.get('q') ?? '')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const { stream, isLoading } = useSSE()
  const contextSlug = searchParams.get('context_entity_slug') || ''

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q || isLoading) return

    setMessages(prev => [...prev, { role: 'user', content: q }])
    setCurrentAnswer('')
    setInput('')

    const body: Record<string, unknown> = { question: q }
    if (contextSlug) body.context_entity_slug = contextSlug

    stream('/api/qa', body, (msg) => {
      if (msg.type === 'token') {
        setCurrentAnswer(prev => prev + (msg.content as string))
      } else if (msg.type === 'error') {
        setCurrentAnswer(`错误: ${msg.message}`)
      } else if (msg.type === 'done') {
        setMessages(prev => [...prev, { role: 'assistant', content: currentAnswer }])
        setCurrentAnswer('')
      }
    })
  }, [input, isLoading, stream, currentAnswer])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="qa" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="qa" />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-3xl space-y-6">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    m.role === 'user'
                      ? 'bg-cyber-blue text-white'
                      : 'bg-white border border-gray-200/50 shadow-sm text-gray-800'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {currentAnswer && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">
                    {currentAnswer}
                  </div>
                </div>
              )}
              {messages.length === 0 && !currentAnswer && (
                <div className="text-center text-gray-400 py-20">
                  <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                  <p className="text-sm">我可以帮你理解架构、定位代码或解释工作原理</p>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent py-6 px-6">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-2 bg-white border border-gray-200/80 rounded-xl shadow-lg p-3 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10 transition-all">
                {contextSlug && (
                  <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-cyber-blue/10 text-cyber-blue text-[10px] font-mono rounded whitespace-nowrap font-bold">
                    #{contextSlug}
                  </span>
                )}
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder={contextSlug ? `对 #${contextSlug} 提问...` : "对代码库提问..."}
                  className="flex-1 bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                />
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
