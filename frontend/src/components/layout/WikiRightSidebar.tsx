import { useMemo, useEffect, useState } from 'react'
import { Hash } from 'lucide-react'

interface Heading { id: string; text: string; level: number }

interface WikiRightSidebarProps { renderedHtml: string }

export function WikiRightSidebar({ renderedHtml }: WikiRightSidebarProps) {
  const [activeId, setActiveId] = useState('')

  const headings: Heading[] = useMemo(() => {
    if (!renderedHtml) return []
    // 从 markdown 原始内容解析标题（# 开头）
    const lines = renderedHtml.split('\n')
    const result: Heading[] = []
    for (const line of lines) {
      const m = line.match(/^(#{1,3})\s+(.+)$/)
      if (m) {
        const level = m[1].length
        const text = m[2].trim()
        const id = text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        result.push({ id, text, level })
      }
    }
    return result
  }, [renderedHtml])

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) setActiveId(e.target.id) },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )
    headings.map(h => document.getElementById(h.id)).filter(Boolean).forEach(el => observer.observe(el!))
    return () => observer.disconnect()
  }, [headings])

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 sticky top-0">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5" /> 文章目录
        </h3>
        {headings.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">暂无目录</div>
        ) : (
          <nav className="space-y-0.5">
            {headings.map(h => (
              <button key={h.id}
                onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={`w-full text-left text-xs py-1 px-2 rounded truncate block transition ${
                  activeId === h.id ? 'text-cyber-blue font-semibold bg-cyber-blue/5 border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-500 hover:text-gray-800'
                }`}
                style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}>
                {h.text}
              </button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}
