import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, useParams, useMatch } from 'react-router-dom'
import { useLayout, type TabType } from '@/contexts/LayoutContext'
import { fetchWikiModules, fetchTopics } from '@/api/client'
import type { Topic } from '@/types'
import { SettingsModal } from '@/components/settings/SettingsModal'
import {
  BookOpen, MessageSquare, FileText, Database, Settings,
  Plus, ChevronLeft, ChevronDown, GitFork, Search,
} from 'lucide-react'

interface WikiModule {
  slug: string; name: string; type: string; title?: string
}

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setActiveTab } = useLayout()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Doc tree data
  const [modules, setModules] = useState<WikiModule[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [kbDropdownOpen, setKbDropdownOpen] = useState(false)

  // KB list from API
  const [kbList, setKbList] = useState<{name: string}[]>([])

  // Session history for QA page
  const [sessionList, setSessionList] = useState<{id: string; title: string; created_at: string}[]>([])
  const [sessionsExpanded, setSessionsExpanded] = useState(true)

  // useParams doesn't work outside <Routes> — use useMatch instead
  const wikiMatch = useMatch('/wiki/:name')
  const repoMatch = useMatch('/:repo')
  // Avoid matching well-known paths as repo names
  const isRepoRoute = repoMatch && !['qa', 'admin', 'sources', 'settings', 'wiki', 'repos'].includes(repoMatch.params.repo || '')
  const currentKB = wikiMatch?.params.name || (isRepoRoute ? repoMatch?.params.repo : '') || kbList[0]?.name || ''

  useEffect(() => {
    fetchWikiModules().then(setModules).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
    fetch('/api/knowledge').then(r => r.json()).then(d => {
      setKbList(d.data || [])
    }).catch(() => {})
  }, [])

  // Fetch sessions on mount and every navigation
  const fetchSessions = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(list => {
      if (Array.isArray(list)) setSessionList(list)
    }).catch(e => console.warn('Session fetch failed:', e))
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions, location.pathname])

  const toggleSidebar = () => setSidebarOpen(o => !o)

  const isActive = (path: string) => {
    if (path === '/qa') return location.pathname === '/qa' || location.pathname.startsWith('/qa/')
    if (path === '/wiki') return location.pathname.startsWith('/wiki') || !!isRepoRoute
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const handleTabClick = (tab: TabType, path: string) => {
    setActiveTab(tab)
    // QA tab: 已在 /qa 时不动，其他情况都跳转
    if (tab === 'qa' && location.pathname === '/qa') return
    navigate(path)
  }

  // Filter modules by current KB
  const kbModules = useMemo(() => {
    if (!currentKB) return modules
    return modules.filter(m => {
      const source = m.name.split(' / ')[0]
      return source === currentKB
    })
  }, [modules, currentKB])

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Build doc tree
  const docTree = useMemo(() => {
    interface TreeNode { dirs: Record<string, TreeNode>; files: WikiModule[] }
    const root: TreeNode = { dirs: {}, files: [] }
    for (const m of kbModules) {
      if (m.type !== 'source') continue
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
      const indent = depth * 16
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 12}px` }}
              className="w-full flex items-center gap-1 text-left py-1 pr-2 rounded-md text-sm text-sidebar-text/70 hover:bg-white/5 hover:text-sidebar-active transition-colors">
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-sidebar-text/40 ${isExpanded ? '' : '-rotate-90'}`} />
              <span className="truncate">{dirName}</span>
            </button>
            {isExpanded && <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>}
          </div>
        )
      }
      for (const m of node.files.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))) {
        els.push(
          <button key={m.slug} onClick={() => navigate(`/wiki/${currentKB}#${m.slug}`)}
            style={{ paddingLeft: `${indent + 32}px` }}
            className={`block w-full text-left py-1 pr-2 rounded-md text-sm leading-snug hover:bg-white/5 transition-colors truncate ${
              location.hash === `#${m.slug}` ? 'text-cyber-blue-light bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60 hover:text-sidebar-active'
            }`}>
            {m.title || m.slug.split('/').pop()}
          </button>
        )
      }
      return els
    }
    return renderNode(root, 0, '')
  }, [kbModules, expandedDirs, currentKB, location.hash, navigate])

  // Show doc tree area on Wiki-related paths
  const showDocTree = location.pathname.startsWith('/wiki') || !!isRepoRoute

  return (
    <>
      <aside className={`h-screen bg-sidebar-bg flex flex-col shrink-0 z-30 transition-all duration-200 border-r border-slate-700/50 ${sidebarOpen ? 'w-[260px]' : 'w-14'}`}>
        {/* Logo row — 和 WeKnora 一致的 header 高度 */}
        <div className={`flex items-center h-[50px] shrink-0 ${sidebarOpen ? 'px-[14px] justify-between' : 'justify-center'}`}>
          <button onClick={toggleSidebar}
            className="w-8 h-8 bg-gradient-to-br from-cyber-blue to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm hover:from-cyber-blue-dark hover:to-indigo-700 transition-all shrink-0 shadow-sm">
            W
          </button>
          {sidebarOpen && (
            <span className="text-sm font-bold text-sidebar-active/90 truncate ml-3 tracking-wide">OpenCodeWiki</span>
          )}
          {sidebarOpen && (
            <button onClick={toggleSidebar} className="w-[18px] h-[18px] flex items-center justify-center rounded text-sidebar-text/40 hover:text-sidebar-active transition-colors ml-auto">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Nav tabs — 和 WeKnora menu_items 对齐 */}
        <nav className="flex flex-col gap-[2px] px-[6px] mb-2">
          {[
            { key: 'qa' as TabType, icon: MessageSquare, label: '新问题', path: '/qa' },
            { key: 'read' as TabType, icon: BookOpen, label: 'Wiki', path: '/wiki' },
            { key: 'wiki' as TabType, icon: FileText, label: '知识沉淀', path: '/admin' },
            { key: 'sources' as TabType, icon: Database, label: '知识库', path: '/sources' },
          ].map(tab => (
            <button key={tab.key} onClick={() => handleTabClick(tab.key, tab.path)}
              title={tab.label}
              className={`flex items-center rounded-lg transition-colors ${
                sidebarOpen
                  ? 'w-full h-[36px] px-[10px] gap-[8px]'
                  : 'w-9 h-9 justify-center mx-auto'
              } ${
                isActive(tab.path)
                  ? 'bg-cyber-blue/15 text-cyber-blue-light font-semibold'
                  : 'text-sidebar-text/60 hover:bg-white/5 hover:text-sidebar-active'
              }`}>
              <tab.icon className="w-[18px] h-[18px] shrink-0" />
              {sidebarOpen && <span className="text-sm font-semibold">{tab.label}</span>}
            </button>
          ))}
        </nav>

        {/* KB Dropdown — Wiki pages only */}
        {sidebarOpen && showDocTree && (
          <div className="px-[6px] mb-2">
            <div className="relative">
              <button onClick={() => setKbDropdownOpen(o => !o)}
                className="w-full flex items-center gap-[8px] h-[32px] px-[10px] rounded-lg text-sm text-sidebar-text/60 hover:bg-white/5 hover:text-sidebar-active transition-colors">
                <GitFork className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-sm">{currentKB || '选择知识库'}</span>
                <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform text-sidebar-text/40 ${kbDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {kbDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700/60 rounded-lg shadow-lg shadow-black/20 py-1 z-40"
                  onMouseLeave={() => setKbDropdownOpen(false)}>
                  {kbList.map(kb => (
                    <button key={kb.name}
                      onClick={() => { navigate(`/wiki/${kb.name}`); setKbDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/5 transition-colors ${
                        currentKB === kb.name ? 'text-cyber-blue-light bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60'
                      }`}>
                      {kb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Separator */}
        {sidebarOpen && showDocTree && <div className="mx-[10px] border-t border-slate-700/30" />}

        {/* Doc Tree / Session History */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto min-h-0 mt-1.5 px-[6px] sidebar-scrollable">
            {showDocTree ? (
              /* Doc tree */
              <div>
                <div className="flex items-center justify-between px-[10px] mb-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">文档</span>
                  <button className="text-slate-600 hover:text-slate-400 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {kbModules.length > 0 ? docTree : (
                  <div className="text-sm text-slate-600 px-[10px] py-5 text-center">暂无文档</div>
                )}
                {/* Topics in sidebar */}
                {topics.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-700/30">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1 px-[10px]">主题</div>
                    {topics.map(t => (
                      <button key={t.slug} onClick={() => navigate(`/wiki/${currentKB}#${t.slug}`)}
                        className={`block w-full text-left px-[10px] py-1 rounded-md text-sm hover:bg-white/5 transition-colors truncate ${
                          location.hash === `#${t.slug}` ? 'text-cyber-blue-light bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60 hover:text-sidebar-active'
                        }`}>
                        #{t.slug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : location.pathname === '/' ? (
              /* Homepage — empty */
              <div />
            ) : (
              /* QA / Admin / Other pages — session history */
              <div>
                <button onClick={() => setSessionsExpanded(o => !o)}
                  className="w-full flex items-center gap-1 px-[10px] h-[30px] text-[11px] font-semibold text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors rounded-md">
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-slate-600 ${sessionsExpanded ? '' : '-rotate-90'}`} />
                  历史问答
                </button>
                {sessionsExpanded && (
                  sessionList.length > 0 ? sessionList.map(s => (
                    <button key={s.id}
                      onClick={() => navigate(`/qa/${s.id}`)}
                      className={`block w-full text-left px-[10px] py-1.5 rounded-md text-sm leading-snug hover:bg-white/5 transition-colors truncate ${
                        location.pathname === `/qa/${s.id}` ? 'text-cyber-blue-light bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60 hover:text-sidebar-active'
                      }`}>
                      {s.title || '新对话'}
                    </button>
                  )) : (
                    <div className="text-sm text-slate-600 px-[10px] py-5 text-center">暂无问答记录</div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom area: Settings + User — 仿 WeKnora menu_bottom */}
        <div className="flex-shrink-0 flex flex-col gap-[2px] px-[6px] mb-2 mt-auto pt-2 border-t border-slate-700/30">
          {/* Settings */}
          <button onClick={() => setSettingsOpen(true)} title="设置"
            className="flex items-center gap-[8px] h-[36px] px-[10px] rounded-lg text-sidebar-text/60 hover:bg-white/5 hover:text-sidebar-active transition-colors">
            <Settings className="w-[18px] h-[18px] shrink-0" />
            {sidebarOpen && <span className="text-sm font-semibold">设置</span>}
          </button>

          {/* User info */}
          <div className="flex items-center gap-[8px] px-[10px] h-[36px] rounded-lg text-sidebar-text/60">
            <div className="w-7 h-7 rounded-full bg-slate-600/50 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0">
              L
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sidebar-text/80 truncate">Long</div>
                <div className="text-[10px] text-slate-500 truncate">long@example.com</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* SettingsModal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
