import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Terminal, ArrowRight } from 'lucide-react'

interface BottomInputProps {
  placeholder?: string
  contextTag?: string
  visible: boolean
}

export function BottomInput({ placeholder = '提出新疑问...', contextTag, visible }: BottomInputProps) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  if (!visible) return null

  const handleSend = () => {
    const q = value.trim()
    if (!q) return
    const params = new URLSearchParams({ q })
    if (contextTag) params.set('context_entity_slug', contextTag)
    navigate(`/qa?${params.toString()}`)
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent flex items-end justify-center pointer-events-none z-20">
      <div className="w-full max-w-2xl px-6 pb-8 pointer-events-auto">
        <div className="bg-white/90 backdrop-blur-md border border-gray-200/80 rounded-xl shadow-lg p-3 transition-all duration-200 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1"
              placeholder={placeholder}
            />
            {contextTag && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 text-[10px] font-mono rounded whitespace-nowrap">
                #{contextTag}
              </span>
            )}
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend}>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
