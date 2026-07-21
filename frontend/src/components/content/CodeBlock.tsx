import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface CodeBlockProps {
  children: string
  language?: string
  filename?: string
  source?: string
  explanation?: string
}

export function CodeBlock({ children, language = 'text', filename, source, explanation }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-6 rounded-xl overflow-hidden border border-code-bg/20 shadow-sm">
      {/* File header bar */}
      {(filename || language) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 text-xs font-mono">
          {filename && <span className="font-semibold text-slate-200">{filename}</span>}
          {language && (
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{language}</span>
          )}
          <button onClick={handleCopy} className="ml-auto p-1 hover:bg-slate-700 rounded transition" title="复制">
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Code area */}
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        customStyle={{ margin: 0, padding: '16px', borderRadius: filename ? '0' : '8px', fontSize: '13px', lineHeight: '1.6' }}
      >
        {children}
      </SyntaxHighlighter>

      {/* Source trace line */}
      {source && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 text-[11px] text-slate-400 font-mono border-t border-slate-800">
          <ExternalLink className="w-3 h-3" />
          <span>{source}</span>
        </div>
      )}

      {/* AI explanation line */}
      {explanation && (
        <div className="px-4 py-1.5 bg-slate-900 text-[11px] text-slate-500 border-t border-slate-800 italic">
          💡 {explanation}
        </div>
      )}
    </div>
  )
}
