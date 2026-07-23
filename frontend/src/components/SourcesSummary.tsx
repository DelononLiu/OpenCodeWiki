import { useState, useMemo } from 'react'
import { FileText, ChevronDown, ChevronRight } from 'lucide-react'
import type { QASource } from '@/types/opencodewiki'

interface SourcesSummaryProps {
  sources: QASource[]
}

export default function SourcesSummary({ sources }: SourcesSummaryProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())

  // Group by doc_title
  const groups = useMemo(() => {
    const map = new Map<string, QASource[]>()
    for (const s of sources) {
      const list = map.get(s.doc_title) || []
      list.push(s)
      map.set(s.doc_title, list)
    }
    return Array.from(map.entries())
  }, [sources])

  const toggleDoc = (title: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  if (!sources.length) return null

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs text-gray-500 cursor-pointer hover:bg-gray-50 select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          <span className="font-medium">引用来源</span>
          <span className="text-gray-400">({sources.length} 条)</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </div>

      {/* Groups */}
      {!collapsed && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {groups.map(([title, chunks]) => (
            <div key={title}>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 cursor-pointer hover:bg-gray-50 select-none"
                onClick={() => toggleDoc(title)}
              >
                {expandedDocs.has(title) ? (
                  <ChevronDown className="w-3 h-3 shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="w-3 h-3 shrink-0 text-gray-400" />
                )}
                <span className="font-medium truncate">{title}</span>
                <span className="text-gray-400 shrink-0">({chunks.length})</span>
              </div>
              {expandedDocs.has(title) && (
                <div className="px-6 pb-2 space-y-1">
                  {chunks.map((chunk, i) => (
                    <div key={i} className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded px-2 py-1">
                      <span className="text-gray-400 mr-1">#{i + 1}</span>
                      {chunk.content.slice(0, 150)}
                      {chunk.content.length > 150 && '...'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
