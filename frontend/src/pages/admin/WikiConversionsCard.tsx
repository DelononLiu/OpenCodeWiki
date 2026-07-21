import { useState, useEffect } from 'react'
import { fetchWikiConversions } from '@/api/client'
import type { WikiConversion } from '@/types'
import { ChevronDown, ChevronRight, ExternalLink, BookOpen } from 'lucide-react'

interface WikiConversionsCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function WikiConversionsCard({ expanded, onToggle, onUpdate }: WikiConversionsCardProps) {
  const [conversions, setConversions] = useState<WikiConversion[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchWikiConversions()
      setConversions(data.conversions || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">⑤ 已沉淀 Wiki</span>
          {conversions.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
              {conversions.length} 篇
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {loading && (
            <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
          )}
          {!loading && conversions.map(c => (
            <a key={c.id}
              href={`/wiki/${c.wiki_slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-gray-50 border border-gray-200 rounded-lg p-3 hover:border-cyber-blue/30 transition group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <BookOpen className="w-4 h-4 text-cyber-blue shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-800 truncate">
                      {c.wiki_title || c.wiki_slug}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                      <span className="font-mono">{c.wiki_slug}</span>
                      {c.module_slug && (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded">{c.module_slug}</span>
                      )}
                      <span>{c.qa_count} QA</span>
                      <span>{c.created_at?.slice(0, 10)}</span>
                    </div>
                  </div>
                </div>
                <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-cyber-blue shrink-0" />
              </div>
            </a>
          ))}
          {!loading && conversions.length === 0 && (
            <div className="text-center text-gray-400 py-4 text-sm">
              暂无沉淀记录，在 QA 页面将 session 转为 Wiki 后在此查看
            </div>
          )}
        </div>
      )}
    </div>
  )
}
