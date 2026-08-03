import { useState, useRef, useEffect } from 'react'
import { sedimentSession } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { Sparkles, Loader2 } from 'lucide-react'

export function SedimentMenu({ sessionId, disabled, onDone }: {
  sessionId: string
  disabled?: boolean
  onDone?: (item: KnowledgeItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 提示 3 秒后自动消失
  useEffect(() => {
    if (!msg) return
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), 3000)
    return () => { if (msgTimer.current) clearTimeout(msgTimer.current) }
  }, [msg])

  const run = async (kind: 'card' | 'article') => {
    if (!sessionId || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const item = await sedimentSession(sessionId, kind)
      setOpen(false)
      setMsg(kind === 'card' ? '已沉淀为卡片（可在我的碎片查看）' : '已起草文章（可在知识卡片提交审核）')
      onDone?.(item)
    } catch (e: any) {
      setMsg(e.message || '沉淀失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        title="沉淀为知识"
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-30">
          <button onClick={() => run('card')} className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            沉淀为卡片
          </button>
          <button onClick={() => run('article')} className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            沉淀为文章（草稿）
          </button>
        </div>
      )}
      {msg && <div className="absolute right-0 mt-1 w-52 text-[11px] bg-gray-900 text-white rounded-lg px-3 py-2 z-30">{msg}</div>}
    </div>
  )
}
