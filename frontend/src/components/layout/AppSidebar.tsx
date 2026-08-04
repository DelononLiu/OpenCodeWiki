import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, useMatch } from 'react-router-dom'
import { useLayout, type TabType } from '@/contexts/LayoutContext'
import { useAuth } from '@/contexts/AuthContext'
import { fetchTopics } from '@/api/client'
import type { Topic } from '@/types'
import { fetchWikiTree, fetchKBs, fetchSessions as fetchSessionsApi } from '@/api/opencodewiki'
import type { WikiNode } from '@/types/opencodewiki'
import { WikiTree } from '@/components/wiki/WikiTree'
import { SettingsModal } from '@/components/settings/SettingsModal'
import {
  BookOpen, MessageSquare, Plus, ChevronLeft, ChevronDown, GitFork,
  StickyNote, LayoutGrid, Settings, LogOut, LogIn, Database, FileText,
  type LucideIcon,
} from 'lucide-react'

type Mode = 'qa' | 'knowledge' | 'fragments' | 'cards'

const MODES: { mode: Mode; label: string; icon: LucideIcon; path: string }[] = [
  { mode: 'qa', label: '问答', icon: MessageSquare, path: '/qa' },
  { mode: 'knowledge', label: 'Wiki', icon: BookOpen, path: '/wiki' },
  { mode: 'fragments', label: '我的碎片', icon: StickyNote, path: '/fragments' },
  { mode: 'cards', label: '知识卡片', icon: LayoutGrid, path: '/cards' },
]

// 侧边栏内容按“模式”切换：管理页（/admin /sources）为瞬态视图，回落默认问答内容
function modeForPath(path: string): Mode {
  if (path.startsWith('/wiki')) return 'knowledge'
  if (path.startsWith('/fragments')) return 'fragments'
  if (path.startsWith('/cards')) return 'cards'
  return 'qa'
}

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setActiveTab } = useLayout()
  const { user, logout } = useAuth()

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // 知识模式数据
  const [topics, setTopics] = useState<Topic[]>([])
  const [kbList, setKbList] = useState<{ name: string }[]>([])
  const [wikiTree, setWikiTree] = useState<WikiNode[]>([])
  const [kbDropdownOpen, setKbDropdownOpen] = useState(false)

  // 问答模式数据
  const [sessionList, setSessionList] = useState<{ id: string; title: string; created_at: string }[]>([])
  const [sessionsExpanded, setSessionsExpanded] = useState(true)

  const activeMode = modeForPath(location.pathname)
  const wikiMatch = useMatch('/wiki/:name')
  const currentKB = wikiMatch?.params.name || kbList[0]?.name || ''

  useEffect(() => {
    fetchTopics().then(setTopics).catch(() => {})
    fetchKBs().then(setKbList).catch(() => {})
    fetchWikiTree().then(setWikiTree).catch(() => {})
  }, [])

  // 当前模式同步到 LayoutContext
  useEffect(() => {
    setActiveTab(activeMode)
  }, [activeMode, setActiveTab])

  const fetchSessions = useCallback(() => {
    fetchSessionsApi().then(list => {
      if (Array.isArray(list)) setSessionList(list)
    }).catch(e => console.warn('Session fetch failed:', e))
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions, location.pathname])

  // 新会话创建后刷新列表
  useEffect(() => {
    const handler = () => fetchSessions()
    window.addEventListener('session-created', handler)
    return () => window.removeEventListener('session-created', handler)
  }, [fetchSessions])

  const toggleSidebar = () => setSidebarOpen(o => !o)

  const handleModeClick = (mode: Mode, path: string) => {
    setActiveTab(mode)
    // 问答模式：已在 /qa 时不动（页面本身就是新问答入口）
    if (mode === 'qa' && window.location.pathname === '/qa') return
    navigate(path)
  }

  return (
    <>
      <aside className={`h-screen bg-sidebar-bg flex flex-col shrink-0 z-30 transition-all duration-200 border-r border-slate-200/70 ${sidebarOpen ? 'w-[260px]' : 'w-14'}`}>
        {/* 顶部行：Logo = 折叠切换，标题 = 跳主页 */}
        <div className={`flex items-center h-[50px] shrink-0 ${sidebarOpen ? 'px-[14px] justify-between' : 'justify-center'}`}>
          <button onClick={toggleSidebar}
            className="w-8 h-8 bg-gradient-to-br from-cyber-blue to-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-sm hover:from-cyber-blue-dark hover:to-blue-800 transition-all shrink-0 shadow-sm">
            W
          </button>
          {sidebarOpen && (
            <button onClick={() => navigate('/')} className="text-sm font-bold text-sidebar-active/90 truncate ml-3 tracking-wide hover:text-sidebar-active transition-colors">
              OpenCodeWiki
            </button>
          )}
          {sidebarOpen && (
            <button onClick={toggleSidebar} className="w-[18px] h-[18px] flex items-center justify-center rounded text-sidebar-text/40 hover:text-sidebar-active transition-colors ml-auto">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 模式导航：问答 / Wiki / 我的碎片 / 知识卡片 */}
        <nav className="flex flex-col gap-[2px] px-[6px] mb-2">
          {MODES.map(({ mode, label, icon: Icon, path }) => (
            <button key={mode} onClick={() => handleModeClick(mode, path)} title={label}
              className={`flex items-center rounded-lg transition-colors ${
                sidebarOpen ? 'w-full h-[36px] px-[10px] gap-[8px]' : 'w-9 h-9 justify-center mx-auto'
              } ${
                activeMode === mode
                  ? 'bg-cyber-blue/10 text-cyber-blue font-semibold'
                  : 'text-sidebar-text/60 hover:bg-slate-100 hover:text-sidebar-active'
              }`}>
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {sidebarOpen && <span className="text-sm font-semibold">{label}</span>}
            </button>
          ))}
        </nav>

        {sidebarOpen && <div className="mx-[10px] border-t border-slate-200/70" />}

        {/* 知识模式：知识库下拉 */}
        {sidebarOpen && activeMode === 'knowledge' && (
          <div className="px-[6px] mb-2 mt-2">
            <div className="relative">
              <button onClick={() => setKbDropdownOpen(o => !o)}
                className="w-full flex items-center gap-[8px] h-[32px] px-[10px] rounded-lg text-sm text-sidebar-text/60 hover:bg-slate-100 hover:text-sidebar-active transition-colors">
                <GitFork className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-sm">{currentKB || '选择知识库'}</span>
                <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform text-sidebar-text/40 ${kbDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {kbDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg shadow-slate-200/60 py-1 z-40"
                  onMouseLeave={() => setKbDropdownOpen(false)}>
                  {kbList.map(kb => (
                    <button key={kb.name}
                      onClick={() => { navigate(`/wiki/${kb.name}`); setKbDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 transition-colors ${
                        currentKB === kb.name ? 'text-cyber-blue bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60'
                      }`}>
                      {kb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 内容区：按模式切换 */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto min-h-0 mt-1.5 px-[6px] sidebar-scrollable">
            {activeMode === 'knowledge' ? (
              /* 知识模式：Wiki 目录 + 主题 */
              <div>
                <div className="flex items-center justify-between px-[10px] mb-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">文档</span>
                  <Plus className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <WikiTree nodes={wikiTree} onSelect={n => navigate(`/wiki/node/${n.id}`)} />
                {topics.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-200/70">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1 px-[10px]">主题</div>
                    {topics.map(t => (
                      <button key={t.slug} onClick={() => navigate(`/wiki/${currentKB}#${t.slug}`)}
                        className={`block w-full text-left px-[10px] py-1 rounded-md text-sm hover:bg-slate-100 transition-colors truncate ${
                          location.hash === `#${t.slug}` ? 'text-cyber-blue bg-cyber-blue/10 font-medium' : 'text-sidebar-text/60 hover:text-sidebar-active'
                        }`}>
                        #{t.slug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* 问答模式（默认）：历史会话 */
              <div>
                <button onClick={() => setSessionsExpanded(o => !o)}
                  className="w-full flex items-center justify-between gap-1 px-[10px] h-[30px] text-[11px] font-semibold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors rounded-md">
                  <span className="flex items-center gap-1">
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-sidebar-text/40 ${sessionsExpanded ? '' : '-rotate-90'}`} />
                    历史问答
                  </span>
                  {sessionList.length > 0 && (
                    <span className="text-[10px] font-normal text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5">{sessionList.length}</span>
                  )}
                </button>
                {sessionsExpanded && (
                  sessionList.length > 0 ? sessionList.map(s => (
                    <button key={s.id}
                      onClick={() => navigate(`/qa/${s.id}`)}
                      className={`flex w-full items-center gap-1.5 text-left px-[10px] py-1.5 rounded-md text-sm leading-snug hover:bg-slate-100 transition-colors truncate ${
                        location.pathname === `/qa/${s.id}` ? 'text-cyber-blue bg-cyber-blue/10 font-medium' : 'text-sidebar-text/45 hover:text-sidebar-active'
                      }`}>
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 text-sidebar-text/30" />
                      <span className="truncate">{s.title || '新对话'}</span>
                    </button>
                  )) : (
                    <div className="text-sm text-slate-400 px-[10px] py-5 text-center">暂无问答记录</div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* 底部：用户菜单（设置 / 知识库管理 / 审批台 / 退出） */}
        <div className="flex-shrink-0 px-[6px] mb-2 mt-auto pt-2 border-t border-slate-200/70">
          {user ? (
            <div className="relative">
              <button onClick={() => setUserMenuOpen(o => !o)} title={user.username}
                className={`flex items-center gap-[8px] w-full rounded-lg hover:bg-slate-100 transition-colors ${
                  sidebarOpen ? 'px-[10px] h-[40px]' : 'w-9 h-9 justify-center mx-auto'
                }`}>
                <div className="w-7 h-7 rounded-full bg-cyber-blue/70 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {user.username[0]?.toUpperCase()}
                </div>
                {sidebarOpen && (
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium text-sidebar-text/80 truncate">{user.username}</div>
                    <div className="text-[10px] text-slate-400 truncate">{user.role === 'admin' ? '管理员' : '成员'}</div>
                  </div>
                )}
                {sidebarOpen && (
                  <ChevronDown className={`w-3.5 h-3.5 text-sidebar-text/40 transition-transform shrink-0 ${userMenuOpen ? 'rotate-180' : ''}`} />
                )}
              </button>
              {userMenuOpen && (
                <div className={`absolute bottom-full mb-2 rounded-lg bg-white border border-slate-200 shadow-lg shadow-slate-200/60 py-1 z-40 ${
                  sidebarOpen ? 'left-2 right-2' : 'left-[60px] w-52'
                }`}>
                  <button onClick={() => { setSettingsOpen(true); setUserMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-text/80 hover:bg-slate-100 hover:text-sidebar-active transition-colors">
                    <Settings className="w-4 h-4 shrink-0" />
                    设置
                  </button>
                  <button onClick={() => { navigate('/sources'); setUserMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-text/80 hover:bg-slate-100 hover:text-sidebar-active transition-colors">
                    <Database className="w-4 h-4 shrink-0" />
                    知识库管理
                  </button>
                  <button onClick={() => { navigate('/admin'); setUserMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-text/80 hover:bg-slate-100 hover:text-sidebar-active transition-colors">
                    <FileText className="w-4 h-4 shrink-0" />
                    审批台
                  </button>
                  <div className="my-1 border-t border-slate-200/70" />
                  <button onClick={logout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-slate-100 hover:text-red-600 transition-colors">
                    <LogOut className="w-4 h-4 shrink-0" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => navigate('/login')} title="登录"
              className={`flex items-center gap-[8px] rounded-lg text-sidebar-text/60 hover:bg-slate-100 hover:text-sidebar-active transition-colors ${
                sidebarOpen ? 'w-full h-[36px] px-[10px]' : 'w-9 h-9 justify-center mx-auto'
              }`}>
              <LogIn className="w-[18px] h-[18px] shrink-0" />
              {sidebarOpen && <span className="text-sm font-semibold">登录</span>}
            </button>
          )}
        </div>
      </aside>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
