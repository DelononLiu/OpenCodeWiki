import { useState, useEffect, useMemo } from 'react'
import { Sparkles, FileText, ChevronDown, ChevronRight, Clock, Search, ListOrdered, MessageSquare } from 'lucide-react'
import type { QASource, StageInfo, ProcessSummary } from '@/types/opencodewiki'

interface ProcessPanelProps {
  thinking: string
  thinkingDone: boolean
  thinkingDuration: number
  totalTime?: number
  sources: QASource[]
  stages: StageInfo[]
  summary?: ProcessSummary
}

const STAGE_ICONS: Record<string, typeof Sparkles> = {
  '意图理解': Search,
  '检索': Search,
  '排序': ListOrdered,
  '上下文构建': MessageSquare,
  'LLM推理': Sparkles,
}

export default function ProcessPanel({
  thinking, thinkingDone, thinkingDuration, totalTime, sources, stages, summary,
}: ProcessPanelProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [thinkExpanded, setThinkExpanded] = useState(false)
  const [sourceExpanded, setSourceExpanded] = useState(false)

  // Auto-collapse when answer completes
  useEffect(() => {
    if (thinkingDone && (thinking || sources.length > 0)) {
      setCollapsed(true)
    }
  }, [thinkingDone, thinking, sources.length])

  // During streaming, auto-expand (once we have stages or thinking)
  useEffect(() => {
    if (!thinkingDone && (stages.length > 0 || thinking)) {
      setCollapsed(false)
    }
  }, [thinkingDone, stages.length, thinking])

  const hasContent = thinking || sources.length > 0 || stages.length > 0 || !thinkingDone
  if (!hasContent) return null

  // ── Compute collapsed summary ──
  const thinkingSegments = useMemo(() => {
    if (!thinking) return 0
    // Count double-newline separated blocks as segments
    const blocks = thinking.split(/\n\s*\n/).filter(b => b.trim())
    return Math.max(1, blocks.length)
  }, [thinking])

  const uniqueDocs = useMemo(() => {
    const docs = new Set(sources.map(s => s.doc_title))
    return docs.size
  }, [sources])

  const toolCalls = summary?.queries ?? stages.length

  const displayTime = totalTime || thinkingDuration || 0
  const timeStr = displayTime >= 60
    ? `${Math.floor(displayTime / 60)}分${displayTime % 60}秒`
    : `${displayTime}秒`

  // ── Waterfall helpers ──
  const maxDuration = useMemo(() => {
    let m = 0
    for (const s of stages) {
      if (s.duration_ms && s.duration_ms > m) m = s.duration_ms
    }
    return m || 1
  }, [stages])

  const barWidth = (dur?: number) => {
    if (!dur) return '0%'
    return `${Math.max(3, (dur / maxDuration) * 100)}%`
  }

  const barColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-400'
      case 'running': return 'bg-amber-400 animate-pulse'
      case 'failed': return 'bg-red-400'
      default: return 'bg-gray-200'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-500'
      case 'running': return 'bg-amber-400 animate-ping'
      case 'failed': return 'bg-red-500'
      default: return 'bg-gray-300'
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white text-xs">
      {/* ═══════════════ COLLAPSED HEADER ═══════════════ */}
      <div
        className="flex items-center gap-2 px-3 py-2 text-gray-500 cursor-pointer hover:bg-gray-50 select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto">
          {thinkingSegments > 0 && (
            <span className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
              <span>💭</span>
              <span>{thinkingSegments}次思考</span>
            </span>
          )}
          {toolCalls > 0 && (
            <span className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
              <span>🛠</span>
              <span>{toolCalls}次检索</span>
            </span>
          )}
          {uniqueDocs > 0 && (
            <span className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
              <span>📄</span>
              <span>{uniqueDocs}份文档</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-gray-400 whitespace-nowrap">
            <Clock className="w-3 h-3" />
            <span>{timeStr}</span>
          </span>
        </div>
        {collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        }
      </div>

      {/* ═══════════════ EXPANDED BODY ═══════════════ */}
      {!collapsed && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {/* ── Stage Waterfall ── */}
          {stages.length > 0 && (
            <div className="px-3 py-2 space-y-2">
              <div className="text-gray-400 font-medium text-[10px] uppercase tracking-wider mb-1">流水线</div>
              {stages.map((stage, i) => {
                const Icon = STAGE_ICONS[stage.name] || Sparkles
                return (
                  <div key={stage.name || i} className="flex items-center gap-2">
                    {/* Status dot */}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(stage.status)}`} />
                    {/* Name */}
                    <span className="text-gray-700 w-16 shrink-0 font-medium">{stage.name}</span>
                    {/* Bar */}
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative min-w-[40px]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor(stage.status)}`}
                        style={{ width: barWidth(stage.duration_ms) }}
                      />
                    </div>
                    {/* Duration */}
                    <span className="text-gray-400 w-14 text-right shrink-0 tabular-nums">
                      {stage.duration_ms != null
                        ? stage.duration_ms >= 1000
                          ? `${(stage.duration_ms / 1000).toFixed(1)}s`
                          : `${stage.duration_ms}ms`
                        : stage.status === 'running'
                          ? '...'
                          : '—'
                      }
                    </span>
                    {/* Detail (tooltip on hover or inline for important info) */}
                    {stage.detail && (
                      <span className="text-gray-400 hidden sm:inline truncate max-w-[120px]">{stage.detail}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Thinking ── */}
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
                <span className="font-medium">
                  {thinkingDone ? '思考过程' : '思考中...'}
                </span>
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

          {/* ── Sources ── */}
          {sources.length > 0 && (
            <SourceSection sources={sources} />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Sources Sub-component ── */
function SourceSection({ sources }: { sources: QASource[] }) {
  const [sourceExpanded, setSourceExpanded] = useState(false)
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())

  const sourceGroups = useMemo(() => {
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

  return (
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
  )
}
