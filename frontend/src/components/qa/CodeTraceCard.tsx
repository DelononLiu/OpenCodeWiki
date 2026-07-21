import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface SourceRef {
  file: string
  line: string
  snippet: string
}

interface CodeTraceCardProps {
  sourceRefs: SourceRef[]
}

export function CodeTraceCard({ sourceRefs }: CodeTraceCardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!sourceRefs.length) return null

  return (
    <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        🔗 代码溯源 ({sourceRefs.length})
      </div>
      <div className="divide-y divide-slate-100">
        {sourceRefs.map((ref, i) => {
          const key = `${ref.file}:${ref.line}`
          const isExpanded = expanded.has(key)
          return (
            <div key={i}>
              <button
                onClick={() => toggle(key)}
                className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-slate-50 transition flex items-center gap-1.5"
              >
                <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                <span className="text-cyber-blue font-semibold">{ref.file}</span>
                <span className="text-slate-400">:{ref.line}</span>
              </button>
              {isExpanded && (
                <pre className="mx-3 mb-2 p-2 bg-code-bg text-code-text text-[10px] font-mono rounded overflow-x-auto max-h-24">
                  {ref.snippet}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
