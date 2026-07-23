import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'

interface ThinkingCardProps {
  content: string
  done: boolean
  duration: number  // seconds
}

export default function ThinkingCard({ content, done, duration }: ThinkingCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (done && content) {
      setCollapsed(true)
    }
  }, [done, content])

  // Auto-scroll to bottom during thinking
  useEffect(() => {
    if (!done && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, done])

  if (!content && !done) return null

  const toggle = () => {
    if (done) setCollapsed(c => !c)
  }

  const durationStr = duration >= 60
    ? `${Math.floor(duration / 60)}分${duration % 60}秒`
    : `${duration}秒`

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-2 text-xs select-none ${
          done ? 'cursor-pointer hover:bg-gray-50' : ''
        }`}
        onClick={toggle}
      >
        <div className="flex items-center gap-2">
          {done ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-gray-700 font-medium">已思考</span>
              <span className="text-gray-400">{durationStr}</span>
            </>
          ) : (
            <>
              <span className="relative flex w-3.5 h-3.5 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-amber-400 opacity-60 animate-ping" />
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              </span>
              <span className="text-gray-500 font-medium">思考中...</span>
            </>
          )}
        </div>
        {done && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
              collapsed ? '' : 'rotate-180'
            }`}
          />
        )}
      </div>

      {/* Content — always visible during thinking, toggle when done */}
      {(!done || !collapsed) && content && (
        <div className="border-t border-gray-100">
          <div
            ref={contentRef}
            className="px-3 py-2 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto"
          >
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
