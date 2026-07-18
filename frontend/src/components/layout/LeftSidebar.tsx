import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchTopics, fetchWikiModules } from '@/api/client'
import type { Topic } from '@/types'
import { FileText, BookOpen, Hash, FolderGit, Folder } from 'lucide-react'

interface WikiModule {
  slug: string; name: string; type: string; title?: string
}

interface LeftSidebarProps {
  currentSlug?: string
  currentTopic?: string
  onNavigate?: (slug: string) => void
}

export function LeftSidebar({ currentSlug, currentTopic, onNavigate }: LeftSidebarProps) {
  const navigate = useNavigate()
  const { repo } = useParams<{ repo: string }>()
  const [topics, setTopics] = useState<Topic[]>([])
  const [modules, setModules] = useState<WikiModule[]>([])

  useEffect(() => {
    fetchTopics().then(setTopics).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  // 按 source 名称分组（name 格式为 "source_name/slug"）
  const sourceGroups = useMemo(() => {
    const groups: Record<string, WikiModule[]> = {}
    for (const m of modules) {
      if (m.type !== 'source') continue
      const [sourceName, ...rest] = m.name.split('/')
      const group = sourceName || '其他'
      if (!groups[group]) groups[group] = []
      groups[group].push(m)
    }
    return groups
  }, [modules])

  const handleDocClick = (slug: string) => {
    if (onNavigate) onNavigate(slug)
    else navigate(`/${repo}#${slug}`)
  }

  return (
    <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
      <div className="p-4 space-y-6 text-xs font-medium">
        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
            <FolderGit className="w-3.5 h-3.5" /> 文档
          </h3>
          <ul className="space-y-1 text-gray-600">
            {Object.entries(sourceGroups).map(([sourceName, items]) => (
              <li key={sourceName} className="mb-2">
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                  <Folder className="w-3 h-3" /> {sourceName}
                </div>
                <ul className="space-y-0.5">
                  {items.map(m => (
                    <li key={m.slug}>
                      <button onClick={() => handleDocClick(m.slug)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition ${currentSlug === m.slug ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                        <FileText className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate">{m.title || m.slug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {Object.keys(sourceGroups).length === 0 && (
              <li className="px-3 py-2 text-gray-400">暂无文档</li>
            )}
          </ul>
        </div>
        <div className="pt-2 border-t border-gray-200/50">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
            <Hash className="w-3.5 h-3.5 text-cyber-blue" /> 主题
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
