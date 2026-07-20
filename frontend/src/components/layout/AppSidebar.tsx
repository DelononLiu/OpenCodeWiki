import { useNavigate, useLocation } from 'react-router-dom'
import {
  BookOpen, MessageSquare, Database, Settings,
  Plus, ChevronRight,
} from 'lucide-react'
import { useLayout, type TabType } from '@/contexts/LayoutContext'

const TABS: { key: TabType; icon: typeof BookOpen; label: string }[] = [
  { key: 'read', icon: BookOpen, label: '阅读' },
  { key: 'qa', icon: MessageSquare, label: '问答' },
  { key: 'manage', icon: Database, label: '知识库' },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeTab, setActiveTab, drawerOpen, toggleDrawer, drawerContent } = useLayout()

  const handleTabClick = (tab: TabType) => {
    if (activeTab === tab && drawerOpen) {
      closeDrawerAndReset()
    } else {
      setActiveTab(tab)
      if (!drawerOpen) toggleDrawer()
    }
  }

  const closeDrawerAndReset = () => {
    setActiveTab(null)
    toggleDrawer()
  }

  const handleNewQuestion = () => {
    navigate('/qa')
    setActiveTab('qa')
  }

  return (
    <>
      {/* Icon bar */}
      <aside className="w-14 h-screen bg-white border-r border-gray-200 flex flex-col items-center py-3 shrink-0 z-30">
        <button onClick={closeDrawerAndReset}
          className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono hover:bg-cyber-blue-dark transition mb-4">
          W
        </button>

        <button onClick={handleNewQuestion} title="新问题"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-cyber-blue transition mb-2">
          <Plus className="w-5 h-5" />
        </button>

        <nav className="flex flex-col items-center gap-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => handleTabClick(tab.key)}
              title={tab.label}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
                activeTab === tab.key ? 'bg-cyber-blue/10 text-cyber-blue' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              <tab.icon className="w-5 h-5" />
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <button title="设置" onClick={() => navigate('/settings')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition mb-1">
          <Settings className="w-5 h-5" />
        </button>

        <button title="用户"
          className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 hover:bg-gray-300 transition">
          L
        </button>
      </aside>

      {/* Drawer */}
      {drawerOpen && (
        <div className="w-60 h-screen bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-y-auto no-scrollbar z-20 animate-in slide-in-from-left">
          <div className="p-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{drawerContent.title || ' '}</h2>
              <button onClick={closeDrawerAndReset} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Items */}
            {drawerContent.items.length > 0 ? (
              <div className="space-y-0.5">
                {drawerContent.items.map(item => (
                  <button key={item.id}
                    onClick={item.onClick}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      item.active ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate block">{item.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400 py-8 text-center">
                {activeTab === 'read' ? '暂无页面' : activeTab === 'qa' ? '暂无对话' : '暂无知识库'}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
