import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchTopics, fetchQaEntries } from '@/api/client'
import type { Topic } from '@/types'
import { FileText, BookOpen, Hash, Target, Clock, Activity, FolderGit } from 'lucide-react'

interface LeftSidebarProps {
  pageType: 'wiki' | 'qa' | 'admin'
  currentSlug?: string
  currentTopic?: string
  onNavigate?: (slug: string) => void
}

export function LeftSidebar({ pageType, currentSlug, currentTopic, onNavigate }: LeftSidebarProps) {
  const navigate = useNavigate()
  const { repo } = useParams<{ repo: string }>()
  const [topics, setTopics] = useState<Topic[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (pageType === 'wiki') {
      fetchTopics().then(setTopics).catch(() => {})
    } else if (pageType === 'admin') {
      fetchQaEntries({ status: 'pending', limit: 1 }).then(d => setPendingCount(d.total)).catch(() => {})
    }
  }, [pageType])

  const handleDocClick = (slug: string) => {
    if (onNavigate) onNavigate(slug)
    else navigate(`/${repo}#${slug}`)
  }

  if (pageType === 'wiki') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium">
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <FolderGit className="w-3.5 h-3.5" /> 物理视角
            </h3>
            <ul className="space-y-1 text-gray-600">
              <li>
                <button onClick={() => handleDocClick('overview')}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentSlug === 'overview' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                  <FileText className="w-3.5 h-3.5 text-gray-400" /> 概览
                </button>
              </li>
              <li>
                <button onClick={() => handleDocClick('02-qa-engine')}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentSlug === '02-qa-engine' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                  <BookOpen className="w-3.5 h-3.5 text-gray-400" /> 双路路由算法
                </button>
              </li>
            </ul>
          </div>
          <div className="pt-2 border-t border-gray-200/50">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Hash className="w-3.5 h-3.5 text-cyber-blue" /> 逻辑视角
            </h3>
            <ul className="space-y-1 text-gray-600">
              {topics.map(t => (
                <li key={t.slug}>
                  <button onClick={() => handleDocClick(t.slug)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentTopic === t.slug ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                    <span className="font-mono text-[11px]">#{t.slug}</span>
                    <span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'promoted' ? '已固化' : '聚合中'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    )
  }

  if (pageType === 'qa') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium flex flex-col h-full">
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Target className="w-3.5 h-3.5 text-rose-500" /> 主题快捷过滤
            </h3>
            <ul className="space-y-1">
              <li><button className="w-full flex items-center px-3 py-2 rounded-lg text-left bg-cyber-blue text-white font-bold">🌐 显示全部</button></li>
              {topics.map(t => (
                <li key={t.slug}>
                  <button className="w-full flex items-center px-3 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100">
                    <span className="font-mono">#{t.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="pt-4 border-t border-gray-200/50 flex-1 flex flex-col min-h-0">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Clock className="w-3.5 h-3.5" /> 历史会话
            </h3>
            <div className="flex-1 flex items-center justify-center text-gray-400 text-[11px]">暂无记录</div>
          </div>
        </div>
      </aside>
    )
  }

  if (pageType === 'admin') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium">
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Activity className="w-3.5 h-3.5 text-amber-500" /> 审批控制塔
            </h3>
            <ul className="space-y-1">
              <li>
                <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none">
                  <span className="flex items-center gap-2">⏳ 待审草稿</span>
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                  )}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    )
  }

  return null
}
