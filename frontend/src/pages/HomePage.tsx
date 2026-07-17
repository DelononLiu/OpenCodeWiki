import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchRepos, fetchQaEntries, fetchTopics } from '@/api/client'
import type { Repo, QaEntry, Topic } from '@/types'
import { Search, GitFork, FileText, MessageCircle, Flame } from 'lucide-react'

interface SearchItem {
  type: 'wiki' | 'topic' | 'qa'
  label: string
  key: string
}

export function HomePage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [draftQa, setDraftQa] = useState<QaEntry[]>([])
  const [hotQa, setHotQa] = useState<QaEntry[]>([])
  const [searchVal, setSearchVal] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
    fetchQaEntries({ status: 'pending', limit: 3 }).then(d => setDraftQa(d.entries)).catch(() => {})
    fetchQaEntries({ sort: 'visit', limit: 3 }).then(d => setHotQa(d.entries)).catch(() => {})
  }, [])

  // 动态构建搜索联想池
  const searchPool = useMemo<SearchItem[]>(() => {
    const pool: SearchItem[] = []

    // wiki 文档
    pool.push({ type: 'wiki', label: '📖 物理文档: 双路分流路由算法', key: '02-qa-engine' })
    pool.push({ type: 'wiki', label: '📖 物理文档: 系统设计哲学与愿景', key: 'philosophy' })

    // topic 聚合
    for (const t of topics) {
      pool.push({ type: 'topic', label: `🏷️ 核心主题: #${t.slug}`, key: t.slug })
    }

    // 热门 QA
    for (const qa of hotQa) {
      pool.push({ type: 'qa', label: `💬 常见问答: ${qa.question.slice(0, 40)}`, key: String(qa.qid) })
    }

    return pool
  }, [topics, hotQa])

  const filteredSuggest = searchVal.trim()
    ? searchPool.filter(i => i.label.toLowerCase().includes(searchVal.toLowerCase())).slice(0, 8)
    : []

  const handleSuggestClick = (item: SearchItem) => {
    setShowSuggest(false)
    setSearchVal('')
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
        <div className="max-w-4xl mx-auto space-y-12 py-12 px-6">
          {/* Search Hero */}
          <div className="text-center space-y-5 py-4">
            <div className="flex items-center justify-center gap-2.5">
              <div className="w-9 h-9 bg-cyber-blue rounded-xl flex items-center justify-center text-white font-black text-lg font-mono shadow-md shadow-cyber-blue/20">W</div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">OpenCodeWiki</h1>
            </div>
            <p className="text-gray-400 text-xs max-w-md mx-auto">让项目说明书与日常问答在物理与逻辑层完美联动，自动进化。</p>

            <div className="max-w-2xl mx-auto relative px-4">
              <div className="bg-white border border-gray-200/80 rounded-2xl shadow-lg p-3.5 flex items-center gap-3 transition-all duration-300 focus-within:border-cyber-blue focus-within:ring-4 focus-within:ring-cyber-blue/10">
                <Search className="w-5 h-5 text-gray-400 shrink-0 ml-1" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={e => { setSearchVal(e.target.value); setShowSuggest(true) }}
                  onFocus={() => setShowSuggest(true)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                  placeholder="搜索物理文档、活跃主题或避坑问答... (回车检索)"
                />
                <span className="text-[10px] bg-gray-100 border border-gray-200 text-gray-400 font-mono px-2 py-1 rounded-lg shrink-0">Ctrl + K</span>
              </div>

              {showSuggest && searchVal.trim() && filteredSuggest.length > 0 && (
                <div className="absolute top-full left-4 right-4 bg-white border border-gray-100 rounded-xl shadow-xl mt-1.5 p-2 text-left text-xs z-50">
                  {filteredSuggest.map(item => (
                    <button
                      key={item.label}
                      onClick={() => handleSuggestClick(item)}
                      className="w-full p-2.5 hover:bg-slate-100 rounded-lg flex justify-between items-center transition"
                    >
                      <span className="font-medium text-gray-700">{item.label}</span>
                      <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold">{item.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 4 Grid Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Repo */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <GitFork className="w-4 h-4 text-gray-400" /> 关联物理仓库
              </h3>
              {repos.slice(0, 3).map(r => (
                <div key={r.name} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50 flex justify-between items-center">
                  <div>
                    <span className="font-mono text-xs font-bold text-gray-800 block">{r.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{r.path}</span>
                  </div>
                  <span className="text-[10px] text-cyber-green bg-cyber-green/10 px-2 py-0.5 rounded font-bold">已同步</span>
                </div>
              ))}
              {repos.length === 0 && <div className="text-xs text-gray-400">暂无仓库</div>}
            </div>

            {/* Latest Docs */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition flex flex-col justify-between">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyber-blue" /> 最新物理文档
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <button onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#02-qa-engine`)}
                    className="w-full flex justify-between items-center text-gray-700 hover:text-cyber-blue">
                    <span className="font-semibold">双路分流路由算法系统</span>
                    <span className="text-[10px] text-gray-400">3分钟前更新</span>
                  </button>
                </li>
              </ul>
            </div>

            {/* Latest QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-amber-500" /> 最新流动 Q&A
              </h3>
              <div className="space-y-2.5">
                {draftQa.map(qa => (
                  <div key={qa.qid} onClick={() => navigate('/qa')}
                    className="cursor-pointer border-l-2 border-amber-400 pl-2.5 py-0.5 text-xs group">
                    <div className="font-bold text-gray-800 group-hover:text-cyber-blue transition truncate">{qa.question}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">状态: 待审草稿</div>
                  </div>
                ))}
                {draftQa.length === 0 && <div className="text-xs text-gray-400">暂无最新问答</div>}
              </div>
            </div>

            {/* Hot QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-red-500" /> 沉淀最热 Q&A
              </h3>
              <div className="space-y-2.5">
                {hotQa.map(qa => (
                  <div key={qa.qid} onClick={() => navigate('/qa')}
                    className="cursor-pointer border-l-2 border-cyber-green pl-2.5 py-0.5 text-xs group">
                    <div className="font-bold text-gray-800 group-hover:text-cyber-blue transition truncate">{qa.question}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">已持久化 • {qa.visit_count} 次访问</div>
                  </div>
                ))}
                {hotQa.length === 0 && <div className="text-xs text-gray-400">暂无热门问答</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
