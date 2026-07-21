import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, MessageCircle, Link2, ChevronRight, FolderTree } from 'lucide-react'

interface Heading {
  id: string; text: string; level: number
}

interface QaBrief {
  qid: number; question: string; created_at: string
}

interface WikiLink {
  slug: string; name: string
}

interface SourceRef {
  file: string; line: string; snippet: string
}

interface ContentRightPanelProps {
  pageType?: 'wiki' | 'topic'
  renderedHtml?: string
  qaEntries?: QaBrief[]
  wikiLinks?: WikiLink[]
  sourceRefs?: SourceRef[]
  onSourceClick?: (ref: SourceRef) => void
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function ContentRightPanel({
  pageType = 'wiki',
  renderedHtml = '',
  qaEntries = [],
  wikiLinks = [],
  sourceRefs = [],
  onSourceClick,
}: ContentRightPanelProps) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState('')
  const [expandedSource, setExpandedSource] = useState<string | null>(null)

  // Parse headings from HTML
  const headings = useMemo<Heading[]>(() => {
    const result: Heading[] = []
    const lines = renderedHtml.split('\n')
    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+)$/)
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2].replace(/<[^>]+>/g, ''),
          id: slugify(match[2].replace(/<[^>]+>/g, '')),
        })
      }
    }
    return result
  }, [renderedHtml])

  // Scroll spy
  useEffect(() => {
    const handleScroll = () => {
      const headingElements = headings
        .map(h => document.getElementById(h.id))
        .filter(Boolean) as HTMLElement[]
      let current = ''
      for (const el of headingElements) {
        if (el.getBoundingClientRect().top <= 80) {
          current = el.id
        }
      }
      if (current) setActiveId(current)
    }
    const container = document.querySelector('main') || window
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [headings])

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (pageType === 'topic' && qaEntries.length === 0 && wikiLinks.length === 0) return null
  if (pageType !== 'topic' && headings.length === 0 && sourceRefs.length === 0) return null

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-white flex-shrink-0 overflow-y-auto no-scrollbar">
      <div className="p-3 space-y-4 sticky top-0">
        {/* TOC — Wiki/source pages */}
        {pageType !== 'topic' && headings.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <FolderTree className="w-3 h-3" /> 目录
            </div>
            <nav className="space-y-0.5">
              {headings.map(h => (
                <button key={h.id} onClick={() => scrollToHeading(h.id)}
                  style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                  className={`block w-full text-left py-0.5 pr-2 rounded text-[11px] leading-snug transition border-l-2 ${
                    activeId === h.id
                      ? 'text-cyber-blue font-semibold bg-cyber-blue-light/50 border-cyber-blue'
                      : 'text-gray-500 border-transparent hover:bg-gray-50'
                  }`}>
                  {h.text}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Code trace */}
        {sourceRefs.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> 代码溯源
            </div>
            <div className="space-y-0.5">
              {sourceRefs.map((ref, i) => (
                <div key={i}>
                  <button
                    onClick={() => {
                      setExpandedSource(expandedSource === `${ref.file}:${ref.line}` ? null : `${ref.file}:${ref.line}`)
                      onSourceClick?.(ref)
                    }}
                    className="w-full text-left px-2 py-1 rounded text-[10px] font-mono hover:bg-gray-50 transition text-gray-600 flex items-center gap-1"
                  >
                    <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${expandedSource === `${ref.file}:${ref.line}` ? 'rotate-90' : ''}`} />
                    <span className="text-cyber-blue">{ref.file}</span>
                    <span className="text-gray-400">{ref.line}</span>
                  </button>
                  {expandedSource === `${ref.file}:${ref.line}` && (
                    <pre className="mx-2 my-1 p-2 bg-slate-900 text-slate-300 text-[10px] font-mono rounded overflow-x-auto max-h-32">
                      {ref.snippet}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topic stats */}
        {pageType === 'topic' && (qaEntries.length > 0 || wikiLinks.length > 0) && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              📊 Topic 统计
            </div>
            <div className="text-[11px] text-gray-500 space-y-1 px-1">
              {qaEntries.length > 0 && <div>{qaEntries.length} 个 QA 条目</div>}
              {wikiLinks.length > 0 && <div>{wikiLinks.length} 个关联文档</div>}
            </div>
          </div>
        )}

        {/* Related QA */}
        {qaEntries.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <MessageCircle className="w-3 h-3 text-amber-500" /> 关联 QA
            </div>
            <div className="space-y-0.5">
              {qaEntries.map(qa => (
                <button key={qa.qid}
                  onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-gray-50 transition text-gray-600 truncate">
                  <span className="text-cyber-blue font-mono text-[10px] mr-1">Q{qa.qid}</span>
                  {qa.question.slice(0, 30)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Related wiki */}
        {wikiLinks.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <FileText className="w-3 h-3 text-cyber-blue" /> 关联页面
            </div>
            <div className="space-y-0.5">
              {wikiLinks.map(link => (
                <button key={link.slug}
                  onClick={() => { window.location.hash = link.slug }}
                  className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-gray-50 transition text-gray-600 truncate">
                  {link.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Placeholder sections for wiki pages */}
        {pageType !== 'topic' && (
          <>
            {/* Related Topics placeholder */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">🏷️ 关联 Topic</div>
              <div className="text-[10px] text-gray-300 px-2">暂无关联 Topic</div>
            </div>
            {/* Related Docs placeholder */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">📖 相关文档</div>
              <div className="text-[10px] text-gray-300 px-2">暂无相关文档</div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
