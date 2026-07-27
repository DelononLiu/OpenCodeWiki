import { useState, useRef, useEffect } from 'react'
import { Pencil, MessageSquare, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ParagraphCorrection as CorrectionType } from './types'

interface ParagraphCorrectionProps {
  content: string
  corrections: CorrectionType[]
  onSubmitCorrection: (paragraphIdx: number, suggestion: string) => void
  onReplyToCorrection: (correctionId: string, text: string) => void
}

export function ParagraphCorrection({
  content,
  corrections,
  onSubmitCorrection,
  onReplyToCorrection,
}: ParagraphCorrectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})

  // Split into lines for hover targeting
  const lines = content.split('\n')

  const lineCorrections = (lineIdx: number) =>
    corrections.filter(c => c.paragraphIdx === lineIdx)

  const toggleExpand = (lineIdx: number) => {
    setExpandedLines(prev => {
      const next = new Set(prev)
      if (next.has(lineIdx)) next.delete(lineIdx)
      else next.add(lineIdx)
      return next
    })
  }

  const handleReply = (correctionId: string) => {
    const text = replyInputs[correctionId]?.trim()
    if (!text) return
    onReplyToCorrection(correctionId, text)
    setReplyInputs(prev => {
      const next = { ...prev }
      delete next[correctionId]
      return next
    })
  }

  return (
    <div ref={containerRef} className="relative">
      {lines.map((line, idx) => {
        const pCorrections = lineCorrections(idx)
        const isExpanded = expandedLines.has(idx)
        const isEmpty = !line.trim()

        // Empty line → spacer
        if (isEmpty && !pCorrections.length) {
          return <div key={idx} className="h-3" />
        }

        return (
          <div
            key={idx}
            className={cn(
              'relative rounded-sm',
              pCorrections.length > 0 ? 'bg-amber-50/40' : 'hover:bg-gray-50',
            )}
            onMouseEnter={() => setHoveredLine(idx)}
            onMouseLeave={() => {
              if (hoveredLine === idx) setHoveredLine(null)
            }}
          >
            {/* 行内容 */}
            <div className="flex-1 min-w-0 py-[1px] relative">
              {editingLine === idx ? (
                <div className="space-y-1.5 py-1">
                  <span className="text-xs text-gray-500 leading-relaxed">{line}</span>
                  <div className="text-[11px] text-amber-600 font-medium">纠错建议：</div>
                  <textarea
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-full min-h-[52px] text-xs border border-amber-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-amber-300/40 resize-y bg-white"
                    placeholder="输入正确的表述…"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!editValue.trim()) return
                        onSubmitCorrection(idx, editValue.trim())
                        setEditingLine(null)
                        setEditValue('')
                      }}
                      disabled={!editValue.trim()}
                      className="px-2.5 py-1 text-[11px] font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
                    >
                      提交纠错
                    </button>
                    <button
                      onClick={() => setEditingLine(null)}
                      className="px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 用 ReactMarkdown 渲染每行 + 行尾按钮 */}
                  {!isEmpty && (
                    <div className="flex items-start gap-1">
                      <div className="flex-1 min-w-0 prose prose-sm max-w-none prose-p:leading-7 prose-p:my-0 prose-headings:my-0 prose-code:text-cyber-blue prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{line}</ReactMarkdown>
                      </div>
                      {hoveredLine === idx && !editingLine && (
                        <div className="shrink-0 flex items-center gap-0.5 pt-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingLine(idx); setEditValue('') }}
                            className="p-0.5 rounded text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                            title="挑错"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {pCorrections.length > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(idx) }}
                              className="p-0.5 rounded text-amber-400 hover:text-amber-600 transition-colors"
                              title={`${pCorrections.length} 条纠错`}
                            >
                              <MessageSquare className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 纠错线程（展开/折叠） */}
                  {pCorrections.length > 0 && (
                    <div className="ml-0.5">
                      {isExpanded ? (
                        <div className="mt-1 space-y-1.5 border-l-2 border-amber-200 pl-2.5">
                          <button
                            onClick={() => toggleExpand(idx)}
                            className="text-[10px] text-amber-500 hover:text-amber-600 font-medium"
                          >
                            <X className="w-2.5 h-2.5 inline mr-0.5" />
                            收起
                          </button>
                          {pCorrections.map(c => (
                            <div key={c.id} className="space-y-1">
                              <div className="bg-white rounded border border-amber-100 px-2.5 py-1.5">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-[10px] font-medium text-amber-600">✏️ 纠错</span>
                                  <span className="text-[10px] text-gray-400">{c.createdAt}</span>
                                </div>
                                <p className="text-[11px] text-gray-700">{c.suggestion}</p>
                              </div>
                              {c.replies.map(r => (
                                <div key={r.id} className="bg-white rounded border border-gray-100 px-2.5 py-1.5 ml-3">
                                  <span className="text-[10px] font-medium text-gray-500">💬 {r.text}</span>
                                </div>
                              ))}
                              <div className="flex items-start gap-1 ml-3">
                                <input
                                  type="text"
                                  value={replyInputs[c.id] || ''}
                                  onChange={e => setReplyInputs(prev => ({ ...prev, [c.id]: e.target.value }))}
                                  placeholder="回复…"
                                  className="flex-1 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-cyber-blue/30"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault()
                                      handleReply(c.id)
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => handleReply(c.id)}
                                  disabled={!replyInputs[c.id]?.trim()}
                                  className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-cyber-blue rounded hover:bg-cyber-blue-dark disabled:opacity-40 transition-colors shrink-0"
                                >
                                  回复
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span
                          onClick={() => toggleExpand(idx)}
                          className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 hover:text-amber-700 cursor-pointer"
                        >
                          <MessageSquare className="w-2.5 h-2.5" />
                          {pCorrections.length} 条纠错
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
