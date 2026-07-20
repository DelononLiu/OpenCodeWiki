import { useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, MessagesSquare, Database, Settings, Search } from 'lucide-react'

const NAV_ITEMS = [
  { path: '/wiki', icon: BookOpen, label: 'Wiki' },
  { path: '/qa', icon: MessagesSquare, label: '问答' },
  { path: '/sources', icon: Database, label: '知识库' },
  { path: '/settings', icon: Settings, label: '设置' },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/wiki') return location.pathname.startsWith('/wiki')
    if (path === '/qa') return location.pathname === '/qa' || location.pathname.startsWith('/qa/q/')
    return location.pathname === path
  }

  return (
    <aside className="w-14 h-screen border-r border-gray-200 bg-white flex flex-col items-center py-3 shrink-0">
      {/* Logo */}
      <button onClick={() => navigate('/')}
        className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono mb-4 hover:bg-cyber-blue-dark transition">
        W
      </button>

      {/* Nav */}
      <nav className="flex flex-col items-center gap-1">
        {NAV_ITEMS.map(item => (
          <button key={item.path} onClick={() => navigate(item.path)}
            title={item.label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
              isActive(item.path)
                ? 'bg-cyber-blue/10 text-cyber-blue'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            <item.icon className="w-5 h-5" />
          </button>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <button title="搜索"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition mb-1">
        <Search className="w-5 h-5" />
      </button>
    </aside>
  )
}
