import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import { fetchQaEntries, fetchQaEntry } from '@/api/client'
import type { QaEntry } from '@/types'
import { Send, Loader2, Search, Plus } from 'lucide-react'

interface Message { role: 'user' | 'assistant'; content: string }

export function QAPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [qaEntries, setQaEntries] = useState<QaEntry[]>([])
  const [selectedQa, setSelectedQa] = useState<QaEntry | null>(null)
  const [viewMode, setViewMode] = useState<'ask' | 'detail'>('ask')
  const [domainFilter, setDomainFilter] = useState('全部')
  const [searchQ, setSearchQ] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(searchParams.get('q') ?? '')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const streamingRef = useRef('')
  const { stream, isLoading } = useSSE()
  const contextSlug = searchParams.get('context_entity_slug') || ''

  useEffect(() => {
    fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)).catch(() => {})
    const qidParam = searchParams.get('qid')
    if (qidParam) {
      fetchQaEntry(Number(qidParam)).then(setSelectedQa).then(() => setViewMode('detail')).catch(() => {})
    }
  }, [searchParams])

  const filtered = useMemo(() => {
    let list = qaEntries
    if (domainFilter !== '全部') list = list.filter(e => e.domain === domainFilter)
    if (searchQ.trim()) list = list.filter(e => e.question.toLowerCase().includes(searchQ.toLowerCase()))
    return list
  }, [qaEntries, domainFilter, searchQ])

  const grouped = useMemo(() => {
    const now = new Date()
    const groups: Record<string, QaEntry[]> = { '今天': [], '三天内': [], '本周': [], '本月': [], '更早': [] }
    filtered.forEach(e => {
      const d = new Date(e.created_at)
      const days = (now.getTime() - d.getTime()) / 86400000
      if (days < 1) groups['今天'].push(e)
      else if (days < 3) groups['三天内'].push(e)
      else if (days < 7) groups['本周'].push(e)
      else if (days < 30) groups['本月'].push(e)
      else groups['更早'].push(e)
    })
    return Object.entries(groups).filter(([, list]) => list.length > 0)
  }, [filtered])

  const domains = useMemo(() => {
    const set = new Set(qaEntries.map(e => e.domain).filter(Boolean))
    return ['全部', ...Array.from(set)]
  }, [qaEntries])

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q || isLoading) return
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setCurrentAnswer(''); setInput('')
    streamingRef.current = ''
    const body: Record<string, unknown> = { question: q }
    if (contextSlug) body.context_entity_slug = contextSlug
    stream('/api/qa', body, msg => {
      if (msg.type === 'token') {
        streamingRef.current += (msg.content as string)
        setCurrentAnswer(prev => prev + (msg.content as string))
      } else if (msg.type === 'error') setCurrentAnswer(`错误: ${msg.message}`)
      else if (msg.type === 'done') {
        const finalAnswer = streamingRef.current
        const lastUserMsg = messages[messages.length - 1]
        setMessages(prev => [...prev, { role: 'assistant', content: finalAnswer }])
        setCurrentAnswer('')
        streamingRef.current = ''

        // 自动保存 QA
        fetch('/api/qa/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: lastUserMsg?.content || '',
            answer: finalAnswer,
            repo: '',
            session_id: Date.now().toString(),
            sources: [],
            mode: 'deep',
          }),
        }).then(() => fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)))
        .catch(() => {})
      }
    })
  }, [input, isLoading, stream, contextSlug])

  const handleSelectQa = async (qid: number) => {
    try {
      const qa = await fetchQaEntry(qid)
      setSelectedQa(qa)
      setViewMode('detail')
    } catch {}
  }

  const handleNewAsk = () => { setViewMode('ask'); setSelectedQa(null) }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 QA 列表 */}
        <aside className="w-72 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                className="bg-transparent border-none text-xs text-gray-800 placeholder-gray-400 focus:outline-none w-full"
                placeholder="搜索 QA..." />
            </div>
          </div>
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-gray-50">
            {domains.map(d => (
              <button key={d} onClick={() => setDomainFilter(d)} className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition ${
                domainFilter === d ? 'bg-cyber-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>{d}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-4">
            {grouped.map(([label, list]) => (
              <div key={label}>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</h3>
                <div className="space-y-1">
                  {list.map(qa => (
                    <button key={qa.qid} onClick={() => handleSelectQa(qa.qid)}
                      className={`w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition flex items-center justify-between gap-2 ${
                        selectedQa?.qid === qa.qid ? 'bg-cyber-blue/5 border-l-2 border-cyber-blue' : ''
                      }`}>
                      <span className="text-gray-800 truncate flex-1">{qa.question}</span>
                      <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">#{qa.qid}</span>
                      {qa.tags?.[0] && (
                        <span className="text-[10px] text-gray-400 font-mono ml-1">#{qa.tags[0]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-8">暂无 QA 记录，从首页或 Wiki 页底部提问开始</div>
            )}
          </div>
          <div className="p-3 border-t border-gray-100">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleNewAsk}>
              <Plus className="w-3.5 h-3.5 mr-1" /> 新建提问
            </Button>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar bg-[#FBFBFC]">
          {viewMode === 'detail' && selectedQa ? (
            <div className="flex-1 py-8 px-6">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-lg font-bold text-gray-900 mb-4">{selectedQa.question}</h2>
                {selectedQa.answer && (
                  <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm prose prose-slate max-w-none text-sm">
                    {selectedQa.answer}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 py-8 px-6">
                <div className="max-w-3xl mx-auto space-y-6">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                        m.role === 'user' ? 'bg-cyber-blue text-white' : 'bg-white border border-gray-200/50 shadow-sm text-gray-800'
                      }`}>{m.content}</div>
                    </div>
                  ))}
                  {currentAnswer && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">{currentAnswer}</div>
                    </div>
                  )}
                  {messages.length === 0 && !currentAnswer && (
                    <div className="text-center text-gray-400 py-20">
                      <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                      <p className="text-sm">选中左侧 QA 条目查看详情，或下方输入提问</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="sticky bottom-0 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent py-6 px-6">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center gap-2 bg-white border border-gray-200/80 rounded-xl shadow-lg p-3 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10 transition-all">
                    {contextSlug && (
                      <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-cyber-blue/10 text-cyber-blue text-[10px] font-mono rounded whitespace-nowrap font-bold">#{contextSlug}</span>
                    )}
                    <input type="text" value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSend()}
                      placeholder={contextSlug ? `对 #${contextSlug} 提问...` : '对代码库提问...'}
                      className="flex-1 bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1" />
                    <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isLoading}>
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
