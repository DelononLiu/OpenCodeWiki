import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { fetchWikiNodeContent } from '@/api/opencodewiki'
import { Loader2, FileText } from 'lucide-react'

export function WikiNodePage() {
  const { nodeId } = useParams()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!nodeId) return
    setLoading(true)
    fetchWikiNodeContent(nodeId)
      .then(d => { setTitle(d.title); setContent(d.content) })
      .catch((e: any) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [nodeId])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  if (error) return <div className="text-center py-16 text-sm text-red-500">{error}</div>

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-cyber-blue" />
          <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        </div>
        <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}
