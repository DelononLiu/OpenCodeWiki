import { useMemo, useEffect, useState, useRef } from 'react'
import { List } from 'lucide-react'

interface Heading { id: string; text: string; level: number }

interface WikiRightSidebarProps { renderedHtml: string }

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export function WikiRightSidebar({ renderedHtml }: WikiRightSidebarProps) {
  const [activeId, setActiveId] = useState('')
  const ticking = useRef(false)

  const headings: Heading[] = useMemo(() => {
    if (!renderedHtml) return []
    const lines = renderedHtml.split('\n')
    const result: Heading[] = []
    for (const line of lines) {
      const m = line.match(/^(#{1,3})\s+(.+)$/)
      if (m) {
        const level = m[1].length
        const text = m[2].trim()
        const id = slugify(text) || 'heading'
        result.push({ id, text, level })
      }
    }
    return result
  }, [renderedHtml])

  useEffect(() => {
    if (headings.length === 0) return

    const findActive = () => {
      if (ticking.current) return
      ticking.current = true
      requestAnimationFrame(() => {
        ticking.current = false
        // 找到已越过 header 的标题中最后一个（即当前正卡在顶部那条）
        let bestId = headings[0]?.id || ''
        let bestTop = -Infinity
        for (const h of headings) {
          const el = document.getElementById(h.id)
          if (!el) continue
          const top = el.getBoundingClientRect().top
          // 标题 top <= 80（越过 header），取最大的 top 值 = 最后越过的那条
          if (top <= 80 && top > bestTop) {
            bestTop = top
            bestId = h.id
          }
        }
        // 没有标题越过 header → 选中第一个
        setActiveId(bestId)
      })
    }

    const timer = setTimeout(findActive, 200)
    const container = document.querySelector('main') || window
    container.addEventListener('scroll', findActive, { passive: true })
    return () => {
      clearTimeout(timer)
      container.removeEventListener('scroll', findActive)
    }
  }, [headings])

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 sticky top-0">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <List className="w-3.5 h-3.5" /> 目录
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
