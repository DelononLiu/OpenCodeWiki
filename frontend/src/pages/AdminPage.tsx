import { useState, useEffect } from 'react'
import { fetchWikiConversions } from '@/api/client'
import type { WikiConversion } from '@/types'

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
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-lg font-bold text-gray-900">知识沉淀</h1>
            <p className="text-xs text-gray-400 -mt-2">
              QA 对话转为结构化 Wiki 文档，自动索引供后续检索
            </p>

            {loading ? (
              <p className="text-sm text-gray-400 py-8">加载中...</p>
            ) : conversions.length === 0 ? (
              <p className="text-sm text-gray-400 py-8">暂无沉淀记录</p>
            ) : (
              <table className="w-full text-sm bg-white border border-gray-200 rounded-lg">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">标题</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">知识库</th>
                    <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">QA数</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">日期</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {conversions.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 text-gray-800">{c.wiki_title || c.wiki_slug}</td>
                      <td className="px-4 py-2.5 text-gray-500">{c.module_slug || '-'}</td>
                      <td className="px-4 py-2.5 text-center text-gray-500">{c.qa_count}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{c.created_at?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5">
                        <a
                          href={`/wiki/${c.module_slug || ''}#${c.wiki_slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-cyber-blue hover:underline"
                        >
                          查看
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
