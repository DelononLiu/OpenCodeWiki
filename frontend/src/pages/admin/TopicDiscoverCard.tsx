import { useState } from 'react'
import { analyzeTopics, generateDraft } from '@/api/client'
import type { TopicSuggestion } from '@/types'
import { Loader2, ChevronDown, ChevronRight, Plus, Check, X } from 'lucide-react'

interface TopicDiscoverCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function TopicDiscoverCard({ expanded, onToggle, onUpdate }: TopicDiscoverCardProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([])
  const [matched, setMatched] = useState<TopicSuggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmedSlugs, setConfirmedSlugs] = useState<Set<string>>(new Set())
  const [generatingSlugs, setGeneratingSlugs] = useState<Set<string>>(new Set())

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeTopics()
      setSuggestions(result.suggestions || [])
      setMatched(result.matched || [])
      if (result.total_new === 0 && (result.matched || []).length === 0) {
        setError('未发现可聚合的 Topic，QA 池可能需要更多数据')
      }
    } catch (e: any) {
      setError(e.message || '分析失败')
    }
    setAnalyzing(false)
    onUpdate()
  }

  const handleConfirmAndGenerate = async (slug: string) => {
    setGeneratingSlugs(prev => new Set(prev).add(slug))
    try {
      await generateDraft(slug)
      setConfirmedSlugs(prev => new Set(prev).add(slug))
    } catch {}
    setGeneratingSlugs(prev => { const n = new Set(prev); n.delete(slug); return n })
    onUpdate()
  }

  const handleRejectSuggestion = (slug: string) => {
    setSuggestions(prev => prev.filter(s => s.slug !== slug))
  }

  const totalCount = suggestions.length + matched.length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">② Topic 发现</span>
          {totalCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold">
              {totalCount} 建议
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          <button onClick={handleAnalyze} disabled={analyzing}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-cyber-blue text-white text-sm font-bold rounded-xl hover:bg-cyber-blue-dark disabled:opacity-50 transition">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {analyzing ? 'LLM 分析中...' : '分析 QA 池'}
          </button>

          {error && (
            <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* New suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">
                🆕 新 Topic 建议
              </h3>
              {suggestions.map(s => (
                <div key={s.slug}
                  className={`border rounded-lg p-3 text-xs space-y-2 ${
                    confirmedSlugs.has(s.slug) ? 'border-green-200 bg-green-50' : 'border-purple-200 bg-purple-50/50'
                  }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-gray-800">#{s.slug}</span>
                      <span className="ml-2 font-medium text-gray-700">{s.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-400">{s.qa_ids.length} QA</span>
                  </div>
                  <p className="text-gray-500">{s.description}</p>
                  {confirmedSlugs.has(s.slug) ? (
                    <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                      <Check className="w-3 h-3" /> Draft 已生成
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => handleConfirmAndGenerate(s.slug)}
                        disabled={generatingSlugs.has(s.slug)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                        {generatingSlugs.has(s.slug) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        确认并生成 Draft
                      </button>
                      <button onClick={() => handleRejectSuggestion(s.slug)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                        <X className="w-3 h-3" /> 忽略
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Matched to existing topics */}
          {matched.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">
                🔗 已匹配到已有 Topic
              </h3>
              {matched.map(m => (
                <div key={m.slug} className="border border-cyber-blue/20 bg-cyber-blue/5 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-gray-800">#{m.slug}</span>
                      <span className="ml-2 text-gray-500">+{m.qa_ids.length} QA 已关联</span>
                    </div>
                    <Check className="w-3 h-3 text-cyber-green" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {suggestions.length === 0 && matched.length === 0 && !analyzing && (
            <div className="text-center text-gray-400 py-4 text-sm">
              点击上方按钮，让 LLM 分析 QA 池
            </div>
          )}
        </div>
      )}
    </div>
  )
}
