import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchRepos, fetchTopics } from '@/api/client'
import type { Repo, Topic } from '@/types'
import { GitFork, Hash, Clock, Plus, ArrowRight } from 'lucide-react'

export function WikiGlobalPage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [topics, setTopics] = useState<Topic[]>([])

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-5xl mx-auto py-10 px-6 space-y-10">

          {/* 代码库 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <GitFork className="w-4 h-4 text-gray-400" /> 代码库
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {repos.map(r => (
                <button key={r.name} onClick={() => navigate(`/${r.name}`)}
                  className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 hover:shadow-sm transition group">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-gray-800 group-hover:text-cyber-blue transition">{r.name}</span>
                    <span className="text-[10px] text-cyber-green bg-cyber-green/10 px-2 py-0.5 rounded-full font-bold shrink-0">已接入</span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono block mt-1 truncate">{r.path}</span>
                </button>
              ))}
              <button onClick={() => navigate('/admin')}
                className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue hover:border-cyber-blue/30 transition">
                <Plus className="w-3.5 h-3.5" /> 提交代码库
              </button>
            </div>
          </section>

          {/* Topic 全景 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Hash className="w-4 h-4 text-cyber-blue" /> Topic 聚合
            </h2>
            {topics.length > 0 ? (
              <div className="grid gap-2">
                {topics.map(t => (
                  <button key={t.slug} onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#${t.slug}`)}
                    className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 transition flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                      <span className="text-sm text-gray-600">{t.name}</span>
                      {t.qa_count != null && (
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{t.qa_count} 条 QA</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        t.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {t.status === 'published' ? '已沉淀' : '聚合中'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-cyber-blue transition" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-12 text-sm">暂无 Topic，从问答积累开始</div>
            )}
          </section>

          {/* 最近变动 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" /> 最近变动
            </h2>
            <div className="text-center text-gray-400 py-8 text-sm">暂无最近变动记录</div>
          </section>

        </div>
      </main>
    </div>
  )
}
