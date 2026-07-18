import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchRepos, fetchQaEntries, fetchTopics } from '@/api/client'
import type { Repo, QaEntry, Topic } from '@/types'
import { Search, GitFork, FileText, MessageCircle, Flame, Plus, ArrowRight } from 'lucide-react'

interface SearchItem {
  type: 'wiki' | 'topic' | 'qa'
  label: string
  key: string
}

export function HomePage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [latestQa, setLatestQa] = useState<QaEntry[]>([])
  const [hotQa, setHotQa] = useState<QaEntry[]>([])
  const [searchVal, setSearchVal] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
    fetchQaEntries({ sort: 'latest', limit: 5 }).then(d => setLatestQa(d.entries)).catch(() => {})
    fetchQaEntries({ sort: 'visit', limit: 5 }).then(d => setHotQa(d.entries)).catch(() => {})
  }, [])

  const searchPool = useMemo<SearchItem[]>(() => {
    const pool: SearchItem[] = []
    pool.push({ type: 'wiki', label: '📖 物理文档: 双路分流路由算法', key: '02-qa-engine' })
    // TODO: 后续从 API 动态获取 wiki 页面列表
    for (const t of topics) {
      pool.push({ type: 'topic', label: `🏷️ 核心主题: #${t.slug}`, key: t.slug })
    }
    for (const qa of hotQa) {
      pool.push({ type: 'qa', label: `💬 常见问答: ${qa.question.slice(0, 40)}`, key: String(qa.qid) })
    }
    return pool
  }, [topics, hotQa])

  const filteredSuggest = searchVal.trim()
    ? searchPool.filter(i => i.label.toLowerCase().includes(searchVal.toLowerCase())).slice(0, 8)
    : []

  const handleSuggestClick = (item: SearchItem) => {
    setShowSuggest(false); setSearchVal('')
    if (item.type === 'qa') navigate('/qa')
    else navigate(`/${repos[0]?.name ?? 'self'}#${item.key}`)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      navigate(`/qa?q=${encodeURIComponent(searchVal.trim())}`)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="home" />
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-5xl mx-auto space-y-10 py-10 px-6">

          {/* Hero Search */}
          <div className="text-center space-y-5 py-6">
            <div className="flex items-center justify-center gap-2.5">
              <div className="w-9 h-9 bg-cyber-blue rounded-xl flex items-center justify-center text-white font-black text-lg font-mono shadow-md shadow-cyber-blue/20">W</div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">OpenCodeWiki</h1>
            </div>
            <p className="text-gray-400 text-sm max-w-md mx-auto">基于代码和问答的自进化团队知识平台</p>
            <div className="max-w-2xl mx-auto relative px-4">
              <div className="bg-white border border-gray-200/80 rounded-2xl shadow-lg p-3.5 flex items-center gap-3 transition-all duration-300 focus-within:border-cyber-blue focus-within:ring-4 focus-within:ring-cyber-blue/10">
                <Search className="w-5 h-5 text-gray-400 shrink-0 ml-1" />
                <input type="text" value={searchVal}
                  onChange={e => { setSearchVal(e.target.value); setShowSuggest(true) }}
                  onFocus={() => setShowSuggest(true)} onKeyDown={handleSearchKeyDown}
                  className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                  placeholder="搜索文档、主题或问答..." />
                <span className="text-[10px] bg-gray-100 border border-gray-200 text-gray-400 font-mono px-2 py-1 rounded-lg shrink-0">Ctrl+K</span>
              </div>
              {showSuggest && searchVal.trim() && filteredSuggest.length > 0 && (
                <div className="absolute top-full left-4 right-4 bg-white border border-gray-100 rounded-xl shadow-xl mt-1.5 p-2 text-left text-xs z-50">
                  {filteredSuggest.map(item => (
                    <button key={item.label} onClick={() => handleSuggestClick(item)}
                      className="w-full p-2.5 hover:bg-slate-100 rounded-lg flex justify-between items-center transition">
                      <span className="font-medium text-gray-700">{item.label}</span>
                      <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold">{item.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 代码库 (全宽独立区域) */}
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <GitFork className="w-4 h-4" /> 代码库
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

          {/* 三内容卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 最新文档 */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyber-blue" /> 最新文档
              </h3>
              <button onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#02-qa-engine`)}
                className="w-full text-left border-l-2 border-cyber-blue pl-3 py-1 text-xs hover:bg-blue-50/50 rounded-r-lg transition">
                <div className="font-semibold text-gray-800 truncate">双路分流路由算法系统</div>
                <div className="text-[10px] text-gray-400 mt-0.5">opencodewiki · 3小时前</div>
              </button>
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/wiki')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有文档 <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* 最新 QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-amber-500" /> 最新问答
              </h3>
              {latestQa.slice(0, 3).map(qa => (
                <div key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="cursor-pointer border-l-2 border-amber-400 pl-3 py-1 text-xs hover:bg-amber-50/50 rounded-r-lg transition mb-1.5">
                  <div className="font-semibold text-gray-800 truncate">{qa.question}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{qa.created_at?.slice(0, 10)}</div>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/qa')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有问答 <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* 最热 QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-red-500" /> 最热问答
              </h3>
              {hotQa.slice(0, 3).map(qa => (
                <div key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="cursor-pointer border-l-2 border-cyber-green pl-3 py-1 text-xs hover:bg-green-50/50 rounded-r-lg transition mb-1.5">
                  <div className="font-semibold text-gray-800 truncate">{qa.question}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{qa.visit_count} 次访问</div>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/wiki')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有 Topic <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
