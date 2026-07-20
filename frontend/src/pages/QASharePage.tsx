import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Header } from '@/components/layout/Header'

interface ShareData {
  qid: number
  question: string
  answer: string
  sources: { file: string; line: string; snippet: string }[]
  created_at: string
  tags: string[]
}

export function QASharePage() {
  const { qid } = useParams<{ qid: string }>()
  const [data, setData] = useState<ShareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!qid) return
    fetch(`/api/qa/share/${qid}`)
      .then(r => r.json())
      .then(d => {
        if (d.qid) {
          setData(d as ShareData)
        } else {
          setError('该问答不存在')
        }
      })
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))
  }, [qid])

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-[#F8F9FA]">
        <Header variant="global" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400 text-sm">加载中...</div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="h-full flex flex-col bg-[#F8F9FA]">
        <Header variant="global" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-2">🔗</div>
            <div className="text-gray-500 text-sm">{error || '内容不存在'}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      <Header variant="global" />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Tags */}
        {data.tags && data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {data.tags.map((tag, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-cyber-blue/10 text-cyber-blue font-medium">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Question */}
        <h1 className="text-xl font-bold text-gray-900 mb-6 pb-3 border-b border-gray-200">
          {data.question}
        </h1>

        {/* Answer */}
        {data.answer ? (
          <div className="prose prose-sm max-w-none mb-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.answer}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-gray-400 text-sm italic mb-8">暂无回答</p>
        )}

        {/* Sources */}
        {data.sources && data.sources.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">参考引用</h3>
            <div className="space-y-2">
              {data.sources.map((src, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between text-gray-400 font-mono mb-1">
                    <span>{src.file}</span>
                    <span>{src.line}</span>
                  </div>
                  <div className="text-gray-600">{src.snippet}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 pt-4 border-t border-gray-200 text-center text-[10px] text-gray-400">
          由 OpenCodeWiki 生成 · Q#{data.qid}
        </div>
      </main>
    </div>
  )
}
