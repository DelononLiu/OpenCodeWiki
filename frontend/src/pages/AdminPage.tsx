import { useState, useEffect } from 'react'
import { fetchWikiConversions } from '@/api/client'
import type { WikiConversion } from '@/types'
import { ExternalLink } from 'lucide-react'

export function AdminPage() {
  const [conversions, setConversions] = useState<WikiConversion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWikiConversions()
      .then(d => setConversions(d.conversions || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-3xl mx-auto space-y-4">
            <h1 className="text-lg font-bold text-gray-900">知识沉淀</h1>
            <p className="text-xs text-gray-400 -mt-2">
              QA 对话转为结构化 Wiki 文档，自动索引供后续检索
            </p>

            {loading ? (
              <p className="text-sm text-gray-400 py-8">加载中...</p>
            ) : conversions.length === 0 ? (
              <p className="text-sm text-gray-400 py-8">暂无沉淀记录</p>
            ) : (
              <div className="space-y-2">
                {conversions.map(c => (
                  <a
                    key={c.id}
                    href={`/wiki/${c.module_slug || ''}#${c.wiki_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-cyber-blue/30 transition group"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-800 group-hover:text-cyber-blue">
                          {c.wiki_title || c.wiki_slug}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">
                          {c.module_slug && `${c.module_slug} · `}{c.qa_count} QA · {c.created_at?.slice(0, 10)}
                        </span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-cyber-blue" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
