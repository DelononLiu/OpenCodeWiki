import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Home, BookOpen, MessagesSquare, ChevronDown, Settings, LogOut, Shield, Database } from 'lucide-react'

const ADMIN_USERS = ['long2015']

interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
}

export function Header({ variant, repoName }: HeaderProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const currentUser = 'long2015'
  const isAdmin = ADMIN_USERS.includes(currentUser)

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-6 h-6 bg-cyber-blue rounded flex items-center justify-center text-white font-black text-xs font-mono">W</div>
          <span className="font-sans font-bold text-sm tracking-tight text-gray-900">OpenCodeWiki</span>
        </div>
        {repoName && variant === 'global' && (
          <>
            <span className="text-gray-300 text-sm">/</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{repoName}</div>
          </>
        )}
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <Home className="w-4 h-4 mr-1.5" /> 首页
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/wiki')}>
          <BookOpen className="w-4 h-4 mr-1.5" /> Wiki
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/qa')}>
          <MessagesSquare className="w-4 h-4 mr-1.5" /> 问答
        </Button>

        {/* 用户下拉 */}
        <div className="relative ml-2">
          <Button variant="ghost" size="sm" onClick={() => setMenuOpen(!menuOpen)} className="gap-1.5">
            <div className="w-5 h-5 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600">
              {currentUser[0].toUpperCase()}
            </div>
            <span className="text-xs text-gray-600 hidden sm:inline">{currentUser}</span>
            <ChevronDown className="w-3 h-3 text-gray-400" />
          </Button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 text-sm">
                <button onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                  <Database className="w-4 h-4 text-cyber-blue" /> 知识管理
                </button>
                {isAdmin && (
                  <button onClick={() => { navigate('/admin'); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                      <Shield className="w-4 h-4 text-amber-500" /> 知识沉淀
                    </button>
                )}
                <div className="border-t border-gray-100 my-1" />
                <button onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                  <Settings className="w-4 h-4" /> 个人设置
                </button>
                <button onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-500">
                  <LogOut className="w-4 h-4" /> 退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
