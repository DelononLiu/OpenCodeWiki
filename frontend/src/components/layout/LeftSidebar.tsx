import { useState, useEffect, useMemo, useCallback } from 'react'
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
      const sourceName = m.name.split(' / ')[0]
      const group = sourceName || '其他'
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

  // 折叠状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // 将多级 slug 渲染为可折叠树形（纯 CSS，不依赖 shadcn Collapsible）
  const renderDocTree = (items: WikiModule[]) => {
    interface TreeNode { dirs: Record<string, TreeNode>; files: WikiModule[] }
    const root: TreeNode = { dirs: {}, files: [] }

    for (const m of items) {
      const parts = m.slug.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] }
        node = node.dirs[parts[i]]
      }
      node.files.push(m)
    }

    const renderNode = (node: TreeNode, depth: number, path: string): React.ReactNode[] => {
      const els: React.ReactNode[] = []
      const indent = depth * 12
      // 文件夹
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 6}px` }}
              className="w-full flex items-center gap-0.5 text-left py-1 pr-2 rounded text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition">
              <span className={`inline-block w-3 h-3 text-center text-[10px] leading-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
              <span className="truncate">📁 {dirName}</span>
            </button>
            {isExpanded && (
              <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>
            )}
          </div>
        )
      }
      // 文件
      for (const m of node.files.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))) {
        els.push(
          <button key={m.slug} onClick={() => handleDocClick(m.slug)}
            style={{ paddingLeft: `${indent + 22}px` }}
            className={`block w-full text-left py-1 pr-2 rounded text-xs leading-snug hover:bg-gray-50 transition truncate ${currentSlug === m.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600'}`}>
            {m.title || m.slug.split('/').pop()}
          </button>
        )
      }
      return els
    }

    return renderNode(root, 0, '')
  }

  return (
    <aside className="w-56 border-r border-gray-200/50 bg-white flex flex-col overflow-y-auto no-scrollbar shrink-0">
      <div className="py-3 px-2 space-y-4">
        <div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-2.5">文档</div>
          <div>
            {Object.entries(sourceGroups).map(([sourceName, items]) => (
              <div key={sourceName}>
                {renderDocTree(items)}
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
