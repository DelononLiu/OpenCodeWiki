import type { QASource } from '@/types/opencodewiki'
import { Card, CardContent } from '@/components/ui/card'
import { FileText, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatWindowProps {
  question: string
  answer: string
  sources: QASource[]
  streaming: boolean
  error: string | null
}

export default function ChatWindow({ question, answer, sources, streaming, error }: ChatWindowProps) {
  return (
    <div className="space-y-4">
      {/* User question */}
      <div className="flex justify-end">
        <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-[80%]">
          {question}
        </div>
      </div>

      {/* Assistant answer */}
      <div className="flex justify-start">
        <div className="bg-gray-100 rounded-lg px-4 py-3 max-w-[85%] min-w-[60%]">
          {streaming && !answer && (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在检索知识库...
            </div>
          )}
          {error ? (
            <div className="text-red-500">{error}</div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {answer || (streaming ? '' : '等待回答...')}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-500">引用来源</h3>
          {sources.map((s, i) => (
            <Card key={i}>
              <CardContent className="py-2 px-3 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <FileText className="w-3 h-3" />
                  <span className="font-medium">{s.doc_title}</span>
                  <span className="text-xs text-gray-400">来源 {i + 1}</span>
                </div>
                <p className="text-gray-500 mt-1 text-xs line-clamp-2">{s.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {streaming && answer && (
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" /> 生成中...
        </div>
      )}
    </div>
  )
}
