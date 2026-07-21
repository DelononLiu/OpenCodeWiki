interface QaSummary {
  qid: number
  question: string
  answer?: string | null
}

interface DraftEditorProps {
  qaEntries: QaSummary[]
  draftContent: string
  onChange: (content: string) => void
  readOnly?: boolean
}

export function DraftEditor({ qaEntries, draftContent, onChange, readOnly = false }: DraftEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left: QA raw content */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          💧 关联问答 ({qaEntries.length})
        </h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {qaEntries.map(qa => (
            <div key={qa.qid} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
              <span className="font-mono text-cyber-blue font-bold text-[10px]">#Q{qa.qid}</span>
              <p className="mt-1 font-medium text-gray-800">{qa.question}</p>
              {qa.answer && (
                <p className="mt-1 text-gray-500 line-clamp-4">{qa.answer}</p>
              )}
            </div>
          ))}
          {qaEntries.length === 0 && (
            <div className="text-center text-gray-400 py-4 text-xs">暂无关联 QA</div>
          )}
        </div>
      </div>

      {/* Right: Draft editor */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">
          🧊 Draft 提炼
        </h3>
        <textarea
          value={draftContent}
          onChange={e => onChange(e.target.value)}
          readOnly={readOnly}
          rows={18}
          className={`w-full text-sm border border-gray-200 rounded-lg p-3 font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical ${
            readOnly ? 'bg-gray-50' : 'bg-white'
          }`}
          placeholder="点击「生成 Draft」或手动输入..."
        />
      </div>
    </div>
  )
}
