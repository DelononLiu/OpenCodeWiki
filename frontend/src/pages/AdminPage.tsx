import { useState, useEffect } from 'react'
import { fetchWikiConversions, deleteWikiConversion } from '@/api/client'
import type { WikiConversion } from '@/types'
import { FileText, Trash2, ExternalLink, Loader2 } from 'lucide-react'

export function AdminPage() {
  const [conversions, setConversions] = useState<WikiConversion[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    fetchWikiConversions()
      .then(d => setConversions(d.conversions || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？相关 wiki 文件和索引也会被清理。')) return
    try {
      await deleteWikiConversion(id)
      setConversions(prev => prev.filter(c => c.id !== id))
    } catch {}
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <div>
              <h1 className="text-lg font-bold text-gray-900">知识沉淀</h1>
              <p className="text-xs text-gray-400 mt-1">
                QA 对话转为结构化 Wiki 文档，自动索引供后续检索
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : conversions.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-400">暂无沉淀记录</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">标题</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">知识库</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 w-16">QA数</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-28">日期</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.map(c => (
                      <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 shrink-0 text-cyber-blue/60" />
                            <span className="text-gray-800 font-medium">{c.wiki_title || c.wiki_slug}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{c.module_slug || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center justify-center min-w-[24px] h-5 bg-cyber-blue/10 text-cyber-blue text-xs font-medium rounded-full px-1.5">
                            {c.qa_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{c.created_at?.slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <a
                              href={`/wiki/${c.module_slug || ''}#${c.wiki_slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-cyber-blue hover:text-cyber-blue-dark transition"
                            >
                              <ExternalLink className="w-3 h-3" /> 查看
                            </a>
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition"
                            >
                              <Trash2 className="w-3 h-3" /> 删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
