import { useNavigate, useLocation } from 'react-router-dom'
import {
  BookOpen, MessagesSquare, Database, Settings,
  Search, ChevronDown, Shield, LogOut,
} from 'lucide-react'
import { useState } from 'react'

const NAV_ITEMS = [
  { path: '/wiki', icon: BookOpen, label: 'Wiki' },
  { path: '/qa', icon: MessagesSquare, label: '问答' },
  { path: '/sources', icon: Database, label: '知识库' },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const currentUser = 'long2015'
  const isAdmin = true

  const isActive = (path: string) => {
    if (path === '/wiki') return location.pathname.startsWith('/wiki')
    if (path === '/qa') return location.pathname === '/qa' || location.pathname.startsWith('/qa/q/')
    return location.pathname === path
  }

  return (
    <aside className="w-14 h-screen border-r border-gray-200 bg-white flex flex-col items-center py-3 shrink-0">
      {/* Logo */}
      <button onClick={() => navigate('/')}
        className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono mb-6 hover:bg-cyber-blue-dark transition">
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

      <div className="flex-1" />

      {/* User avatar */}
      <div className="relative mb-1">
        <button onClick={() => setMenuOpen(!menuOpen)}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          title={currentUser}
        >
          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600">
            {currentUser[0].toUpperCase()}
          </div>
        </button>

        {/* Settings / Logout */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-14 bottom-0 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 text-sm">
              {isAdmin && (
                <button onClick={() => { navigate('/admin'); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                  <Shield className="w-4 h-4 text-amber-500" /> 知识沉淀
                </button>
              )}
              <button onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                <Settings className="w-4 h-4" /> 个人设置
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-500">
                <LogOut className="w-4 h-4" /> 退出登录
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
