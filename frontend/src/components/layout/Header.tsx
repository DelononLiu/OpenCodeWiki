import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { MessagesSquare, Sliders, ChevronRight } from 'lucide-react'

interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
  activeSection?: string
}

export function Header({ variant, repoName }: HeaderProps) {
  const navigate = useNavigate()

  if (variant === 'home') {
    return (
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-6 h-6 bg-cyber-blue rounded flex items-center justify-center text-white font-black text-xs font-mono">W</div>
          <span className="font-sans font-bold text-base tracking-tight text-gray-900">OpenCodeWiki</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/qa')}>
          控制台大厅 <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </header>
    )
  }

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
      <div className="flex items-center gap-4">
        <span onClick={() => navigate('/')} className="font-bold text-sm tracking-tight text-gray-900 cursor-pointer">OpenCodeWiki</span>
        <span className="text-gray-300">/</span>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          {repoName || 'docs-main'}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/qa')}>
          <MessagesSquare className="w-4 h-4 mr-1.5" /> 智能问答
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
          <Sliders className="w-4 h-4 mr-1.5" /> 审批控制台
        </Button>
      </div>
    </header>
  )
}
