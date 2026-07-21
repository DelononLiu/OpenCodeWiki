import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  BookOpen, MessageSquare, Database, Settings,
  FileText, Plus, ChevronLeft,
} from 'lucide-react'
import { useLayout, type TabType } from '@/contexts/LayoutContext'

const TABS: { key: TabType; icon: typeof BookOpen; label: string; path: string }[] = [
  { key: 'read', icon: BookOpen, label: 'Wiki', path: '/wiki' },
  { key: 'qa', icon: MessageSquare, label: '问答', path: '/qa' },
  { key: 'wiki', icon: FileText, label: '知识沉淀', path: '/admin' },
  { key: 'manage', icon: Database, label: '知识库', path: '/sources' },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeTab, setActiveTab, drawerContent } = useLayout()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = () => setSidebarOpen(o => !o)

  const handleTabClick = (tab: TabType, path: string) => {
    setActiveTab(tab)
    navigate(path)
    if (!sidebarOpen) setSidebarOpen(true)
  }

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <aside className={`h-screen bg-white border-r border-gray-200 flex flex-col shrink-0 z-30 transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-14'}`}>

      {/* Logo / Toggle */}
      <div className={`flex items-center py-3 px-3 ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
        <button onClick={toggleSidebar}
          className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono hover:bg-cyber-blue-dark transition shrink-0">
          {sidebarOpen ? 'OCW' : 'W'}
        </button>
        {sidebarOpen && (
          <button onClick={toggleSidebar} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* New Question */}
      <div className={`px-3 mb-2 ${sidebarOpen ? '' : 'flex justify-center'}`}>
        <button onClick={() => { navigate('/qa'); setActiveTab('qa') }}
          title="新问题"
          className={`flex items-center gap-2 rounded-xl transition ${
            sidebarOpen
              ? 'w-full px-3 py-2 bg-cyber-blue/10 text-cyber-blue hover:bg-cyber-blue/20 justify-start'
              : 'w-10 h-10 justify-center text-gray-400 hover:bg-gray-100 hover:text-cyber-blue'
          }`}
        >
          <Plus className="w-5 h-5 shrink-0" />
          {sidebarOpen && <span className="text-xs font-bold">新问题</span>}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 px-2">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => handleTabClick(tab.key, tab.path)}
            title={tab.label}
            className={`flex items-center gap-2 rounded-xl transition ${
              sidebarOpen ? 'w-full px-3 py-2 justify-start' : 'w-10 h-10 justify-center mx-auto'
            } ${
              isActive(tab.path) ? 'bg-cyber-blue/10 text-cyber-blue' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            <tab.icon className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span className="text-xs font-bold">{tab.label}</span>}
          </button>
        ))}
      </nav>

      {/* History list (below 知识库, only when expanded) */}
      {sidebarOpen && drawerContent.items.length > 0 && (
        <div className="flex-1 overflow-y-auto no-scrollbar mt-3 px-2 border-t border-gray-100 pt-2">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-1">
            {drawerContent.title || '历史问答'}
          </div>
          <div className="space-y-0.5">
            {drawerContent.items.map(item => (
              <button key={item.id} onClick={item.onClick}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition ${
                  item.active ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className="truncate block">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <div className={`mb-1 ${sidebarOpen ? 'px-3' : 'flex justify-center'}`}>
        <button onClick={() => navigate('/settings')} title="设置"
          className={`flex items-center gap-2 rounded-xl transition ${
            sidebarOpen ? 'w-full px-3 py-2 justify-start text-gray-500 hover:bg-gray-100' : 'w-10 h-10 justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        >
          <Settings className="w-5 h-5 shrink-0" />
          {sidebarOpen && <span className="text-xs font-bold">设置</span>}
        </button>
      </div>

      {/* User */}
      <div className={`mb-3 ${sidebarOpen ? 'px-3' : 'flex justify-center'}`}>
        <div className={`flex items-center gap-2 ${sidebarOpen ? '' : 'flex-col'}`}>
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">
            L
          </div>
          {sidebarOpen && <span className="text-xs text-gray-500 truncate">long2015</span>}
        </div>
      </div>
    </aside>
  )
}
