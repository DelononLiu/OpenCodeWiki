import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchTopics } from '@/api/client'
import type { Topic } from '@/types'
import { FileText, BookOpen, Hash, FolderGit } from 'lucide-react'

interface LeftSidebarProps {
  currentSlug?: string
  currentTopic?: string
  onNavigate?: (slug: string) => void
}

export function LeftSidebar({ currentSlug, currentTopic, onNavigate }: LeftSidebarProps) {
  const navigate = useNavigate()
  const { repo } = useParams<{ repo: string }>()
  const [topics, setTopics] = useState<Topic[]>([])

  useEffect(() => {
    fetchTopics().then(setTopics).catch(() => {})
  }, [])

  const handleDocClick = (slug: string) => {
    if (onNavigate) onNavigate(slug)
    else navigate(`/${repo}#${slug}`)
  }

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
                  <span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'published' ? '已沉淀' : '聚合中'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  )
}
