import { useState, useMemo } from 'react'
import { Sparkles, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import type { QASource } from '@/types/opencodewiki'

interface ProcessPanelProps {
  thinking: string
  thinkingDone: boolean
  thinkingDuration: number
  sources: QASource[]
}

export default function ProcessPanel({
  thinking, thinkingDone, thinkingDuration, sources,
}: ProcessPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [thinkExpanded, setThinkExpanded] = useState(true)
  const [sourceExpanded, setSourceExpanded] = useState(false)
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())

  // Group sources by doc_title
  const sourceGroups = useMemo(() => {
    const map = new Map<string, QASource[]>()
    for (const s of sources) {
      const list = map.get(s.doc_title) || []
      list.push(s)
      map.set(s.doc_title, list)
    }
    return Array.from(map.entries())
  }, [sources])

  const hasContent = thinking || sources.length > 0 || !thinkingDone
  if (!hasContent) return null

  const thinkingStatus = thinkingDone
    ? '已思考'
    : '思考中...'
  const durationStr = thinkingDuration >= 60
    ? `${Math.floor(thinkingDuration / 60)}分${thinkingDuration % 60}秒`
    : `${thinkingDuration}秒`

  const toggleDoc = (title: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white text-xs">
      {/* Main header — fold/unfold whole panel */}
      <div
        className="flex items-center justify-between px-3 py-2 text-gray-500 cursor-pointer hover:bg-gray-50 select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-medium text-gray-600">处理过程</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {/* ── Thinking node ── */}
          {!!(thinking || !thinkingDone) && (
            <div>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 cursor-pointer hover:bg-gray-50 select-none"
                onClick={() => setThinkExpanded(e => !e)}
              >
                {thinkingDone ? (
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                ) : (
                  <span className="relative flex w-3.5 h-3.5 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 rounded-full border-2 border-amber-400 opacity-60 animate-ping" />
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  </span>
                )}
                <span className="font-medium">{thinkingStatus}</span>
                {thinkingDone && thinking && (
                  <span className="text-gray-400">{durationStr}</span>
                )}
                <span className="ml-auto">
                  {thinkExpanded
                    ? <ChevronDown className="w-3 h-3 text-gray-400" />
                    : <ChevronRight className="w-3 h-3 text-gray-400" />
                  }
                </span>
              </div>
              {thinkExpanded && thinking && (
                <div className="px-6 pb-2">
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto bg-gray-50 rounded px-2 py-1.5">
                    {thinking}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Sources node ── */}
          {sources.length > 0 && (
            <div>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 cursor-pointer hover:bg-gray-50 select-none"
                onClick={() => setSourceExpanded(e => !e)}
              >
                <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="font-medium">引用来源</span>
                <span className="text-gray-400">({sources.length} 条)</span>
                <span className="ml-auto">
                  {sourceExpanded
                    ? <ChevronDown className="w-3 h-3 text-gray-400" />
                    : <ChevronRight className="w-3 h-3 text-gray-400" />
                  }
                </span>
              </div>
              {sourceExpanded && (
                <div className="px-6 pb-2 space-y-1">
                  {sourceGroups.map(([title, chunks]) => (
                    <div key={title}>
                      <div
                        className="flex items-center gap-1 py-1 text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                        onClick={() => toggleDoc(title)}
                      >
                        {expandedDocs.has(title)
                          ? <ChevronDown className="w-3 h-3 shrink-0" />
                          : <ChevronRight className="w-3 h-3 shrink-0" />
                        }
                        <span className="truncate">{title}</span>
                        <span className="text-gray-400 shrink-0">({chunks.length})</span>
                      </div>
                      {expandedDocs.has(title) && (
                        <div className="ml-5 space-y-1">
                          {chunks.map((chunk, i) => (
                            <div key={i} className="text-gray-500 bg-gray-50 rounded px-2 py-1 leading-relaxed">
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
          )}
        </div>
      )}
    </div>
  )
}
