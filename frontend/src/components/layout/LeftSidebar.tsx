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
    <aside className="w-56 border-r border-gray-200/50 bg-white flex flex-col overflow-y-auto no-scrollbar shrink-0">
      <div className="py-3 px-3 space-y-4 text-xs">
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
            <FolderGit className="w-3 h-3" /> 文档
          </div>
          <div className="space-y-0.5">
            {Object.entries(sourceGroups).map(([sourceName, items]) => (
              <div key={sourceName} className="mb-1">
                <div className="text-[10px] text-gray-400 font-medium px-2 py-1 flex items-center gap-1">
                  <Folder className="w-3 h-3 shrink-0" /> {sourceName}
                </div>
                {items.map(m => (
                  <button key={m.slug} onClick={() => handleDocClick(m.slug)}
                    className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[11px] hover:bg-gray-100 transition ${currentSlug === m.slug ? 'bg-cyber-blue/10 text-cyber-blue font-medium' : 'text-gray-600'}`}>
                    <FileText className="w-3 h-3 shrink-0 text-gray-300" />
                    <span className="truncate">{m.title || m.slug}</span>
                  </button>
                ))}
              </div>
            ))}
            {Object.keys(sourceGroups).length === 0 && (
              <div className="px-3 py-4 text-gray-400">暂无文档</div>
            )}
          </div>
        </div>
        <div className="pt-3 border-t border-gray-100">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
            <Hash className="w-3 h-3" /> 主题
          </div>
          <div className="space-y-0.5">
            {topics.map(t => (
              <button key={t.slug} onClick={() => handleDocClick(t.slug)}
                className={`w-full text-left flex items-center justify-between px-2 py-1 rounded text-[11px] hover:bg-gray-100 transition ${currentTopic === t.slug ? 'bg-cyber-blue/10 text-cyber-blue font-medium' : 'text-gray-600'}`}>
                <span className="font-mono truncate">#{t.slug}</span>
                <span className="text-[9px] text-gray-400 shrink-0 ml-1">{t.status === 'published' ? '已沉淀' : '聚合中'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
