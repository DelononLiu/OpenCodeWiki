import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchTopics, fetchWikiModules } from '@/api/client'
import type { Topic } from '@/types'

interface WikiModule {
  slug: string; name: string; type: string; title?: string
}

interface LeftSidebarProps {
  currentSlug?: string
  currentTopic?: string
  currentKb?: string
  onNavigate?: (slug: string) => void
}

export function LeftSidebar({ currentSlug, currentTopic, currentKb, onNavigate }: LeftSidebarProps) {
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
      // 如果指定了当前知识库，只显示该知识库的页面
      if (currentKb && group !== currentKb) continue
      if (!groups[group]) groups[group] = []
      groups[group].push(m)
    }
    return groups
  }, [modules, currentKb])

  const handleDocClick = (slug: string) => {
    if (onNavigate) onNavigate(slug)
    else navigate(`/${repo}#${slug}`)
  }

  return (
    <aside className="w-56 border-r border-gray-200/50 bg-white flex flex-col overflow-y-auto no-scrollbar shrink-0">
      <div className="py-3 px-2 space-y-4">
        <div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-2.5">文档</div>
          <div className="space-y-0.5">
            {Object.entries(sourceGroups).map(([sourceName, items]) => (
              <div key={sourceName}>
                {items.map(m => (
                  <button key={m.slug} onClick={() => handleDocClick(m.slug)}
                    className={`block w-full text-left px-2.5 py-1.5 rounded-md text-sm leading-snug hover:bg-gray-50 transition ${currentSlug === m.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600'}`}>
                    {m.title || m.slug}
                  </button>
                ))}
              </div>
            ))}
            {Object.keys(sourceGroups).length === 0 && (
              <div className="px-2.5 py-4 text-gray-400 text-sm">暂无文档</div>
            )}
          </div>
        </div>
        <div className="pt-3 border-t border-gray-100">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-2.5">主题</div>
          <div className="space-y-0.5">
            {topics.map(t => (
              <button key={t.slug} onClick={() => handleDocClick(t.slug)}
                className={`block w-full text-left px-2.5 py-1.5 rounded-md text-sm leading-snug hover:bg-gray-50 transition ${currentTopic === t.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600'}`}>
                {t.status === 'published' ? '✓ ' : ''}#{t.slug}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
