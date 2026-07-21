import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, useParams, useMatch } from 'react-router-dom'
import { useLayout, type TabType } from '@/contexts/LayoutContext'
import { fetchWikiModules, fetchTopics } from '@/api/client'
import type { Topic } from '@/types'
import { SettingsModal } from '@/components/settings/SettingsModal'
import {
  BookOpen, MessageSquare, FileText, Settings,
  Plus, ChevronLeft, ChevronDown, GitFork,
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
  const [sessionList, setSessionList] = useState<{session_id: string; root_qid: number; root_question: string; created_at: string}[]>([])

  // useParams doesn't work outside <Routes> — use useMatch instead
  const wikiMatch = useMatch('/wiki/:name')
  const repoMatch = useMatch('/:repo')
  // Avoid matching well-known paths as repo names
  const isRepoRoute = repoMatch && !['qa', 'admin', 'sources', 'settings', 'wiki'].includes(repoMatch.params.repo || '')
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
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok && d.data?.sessions) setSessionList(d.data.sessions)
    }).catch(e => console.warn('Session fetch failed:', e))
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions, location.pathname])

  const toggleSidebar = () => setSidebarOpen(o => !o)

  const isActive = (path: string) => {
    if (path === '/wiki') return location.pathname.startsWith('/wiki') || !!isRepoRoute
    return location.pathname.startsWith(path)
  }

  const handleTabClick = (tab: TabType, path: string) => {
    setActiveTab(tab)
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
      const indent = depth * 12
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 12}px` }}
              className="w-full flex items-center gap-0.5 text-left py-0.5 pr-2 rounded text-[11px] font-mono text-sidebar-text hover:bg-white/10 hover:text-sidebar-active transition">
              <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
              <span className="truncate">{dirName}</span>
            </button>
            {isExpanded && <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>}
          </div>
        )
      }
      for (const m of node.files.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))) {
        els.push(
          <button key={m.slug} onClick={() => navigate(`/${currentKB}#${m.slug}`)}
            style={{ paddingLeft: `${indent + 28}px` }}
            className={`block w-full text-left py-0.5 pr-2 rounded text-[11px] leading-snug hover:bg-white/10 transition truncate font-mono ${
              location.hash === `#${m.slug}` ? 'text-sidebar-active bg-white/10' : 'text-sidebar-text'
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
      <aside className={`h-screen bg-sidebar-bg flex flex-col shrink-0 z-30 transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-14'}`}>
        {/* Logo */}
        <div className={`flex items-center py-3 ${sidebarOpen ? 'px-3 justify-between' : 'justify-center'}`}>
          <button onClick={toggleSidebar}
            className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono hover:bg-cyber-blue-dark transition shrink-0">
            W
          </button>
          {sidebarOpen && (
            <span className="text-[11px] font-bold text-sidebar-active truncate ml-2">OpenCodeWiki</span>
          )}
          {sidebarOpen && (
            <button onClick={toggleSidebar} className="p-1 rounded hover:bg-white/10 text-sidebar-text ml-auto">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New Question */}
        <div className={`px-2 mb-2 ${sidebarOpen ? '' : 'flex justify-center'}`}>
          <button onClick={() => { navigate('/qa'); setActiveTab('qa') }}
            title="新问题"
            className={`flex items-center gap-2 rounded-lg transition ${
              sidebarOpen
                ? 'w-full px-3 py-1.5 bg-cyber-blue/20 text-cyber-blue-light hover:bg-cyber-blue/30 justify-start'
                : 'w-8 h-8 justify-center text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
            }`}>
            <Plus className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">新问题</span>}
          </button>
        </div>

        {/* Nav tabs */}
        <nav className="flex flex-col gap-0.5 px-2 mb-2">
          {[
            { key: 'read' as TabType, icon: BookOpen, label: 'Wiki', path: '/wiki' },
            { key: 'qa' as TabType, icon: MessageSquare, label: '问答', path: '/qa' },
            { key: 'wiki' as TabType, icon: FileText, label: 'Topics', path: '/admin' },
          ].map(tab => (
            <button key={tab.key} onClick={() => handleTabClick(tab.key, tab.path)}
              title={tab.label}
              className={`flex items-center gap-2 rounded-lg transition ${
                sidebarOpen ? 'w-full px-3 py-1.5 justify-start' : 'w-8 h-8 justify-center mx-auto'
              } ${
                isActive(tab.path) ? 'bg-cyber-blue/20 text-sidebar-active' : 'text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
              }`}>
              <tab.icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="text-xs font-semibold">{tab.label}</span>}
            </button>
          ))}
        </nav>

        {/* KB Dropdown — Wiki pages only */}
        {sidebarOpen && showDocTree && (
          <div className="px-2 mb-2">
            <div className="relative">
              <button onClick={() => setKbDropdownOpen(o => !o)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-sidebar-text hover:bg-white/10 transition">
                <GitFork className="w-3 h-3 shrink-0" />
                <span className="truncate">{currentKB || '选择知识库'}</span>
                <ChevronDown className="w-3 h-3 ml-auto shrink-0" />
              </button>
              {kbDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-40"
                  onMouseLeave={() => setKbDropdownOpen(false)}>
                  {kbList.map(kb => (
                    <button key={kb.name}
                      onClick={() => { navigate(`/wiki/${kb.name}`); setKbDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-white/10 transition ${
                        currentKB === kb.name ? 'text-cyber-blue-light bg-cyber-blue/10' : 'text-sidebar-text'
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
        {sidebarOpen && showDocTree && <div className="mx-3 border-t border-slate-700" />}

        {/* Doc Tree / Session History */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto no-scrollbar mt-2 px-2">
            {showDocTree ? (
              /* Doc tree */
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-2.5 flex items-center justify-between">
                  文档
                  <button className="text-slate-500 hover:text-sidebar-text">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {kbModules.length > 0 ? docTree : (
                  <div className="text-[10px] text-slate-600 px-2.5 py-4 text-center">暂无文档</div>
                )}
                {/* Topics in sidebar */}
                {topics.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-2.5">主题</div>
                    {topics.map(t => (
                      <button key={t.slug} onClick={() => navigate(`/${currentKB}#${t.slug}`)}
                        className={`block w-full text-left px-2.5 py-1 rounded text-[11px] hover:bg-white/10 transition truncate font-mono ${
                          location.hash === `#${t.slug}` ? 'text-sidebar-active bg-white/10' : 'text-sidebar-text'
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
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-2.5">历史问答</div>
                {sessionList.length > 0 ? sessionList.map((s: any) => (
                  <button key={s.session_id}
                    onClick={() => navigate(`/qa/q${s.root_qid}`)}
                    className={`block w-full text-left px-2.5 py-1.5 rounded text-[11px] leading-snug hover:bg-white/10 transition truncate ${
                      location.pathname === `/qa/q${s.root_qid}` ? 'text-sidebar-active bg-white/10' : 'text-sidebar-text'
                    }`}>
                    {s.root_question || '新对话'}
                  </button>
                )) : (
                  <div className="text-[10px] text-slate-600 px-2.5 py-4 text-center">暂无问答记录</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings icon */}
        <div className={`mb-1 ${sidebarOpen ? 'px-2' : 'flex justify-center'}`}>
          <button onClick={() => setSettingsOpen(true)} title="设置"
            className={`flex items-center gap-2 rounded-lg transition ${
              sidebarOpen ? 'w-full px-3 py-1.5 justify-start text-sidebar-text hover:bg-white/10' : 'w-8 h-8 justify-center text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
            }`}>
            <Settings className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">设置</span>}
          </button>
        </div>

        {/* User */}
        <div className={`mb-3 ${sidebarOpen ? 'px-2' : 'flex justify-center'}`}>
          <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold text-sidebar-text">
            L
          </div>
        </div>
      </aside>

      {/* SettingsModal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
