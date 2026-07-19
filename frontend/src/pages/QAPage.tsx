import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchQaEntries } from '@/api/client'
import { useSSE } from '@/hooks/useSSE'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2, Send, Sidebar, PanelRight,
  ThumbsUp, ThumbsDown, Copy, MoreHorizontal,
  Hash, HelpCircle, Clock, Check,
} from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  sessionId: string
  question: string
  messages: Message[]
  streamingAnswer: string
  isStreaming: boolean
  feedback?: 'accepted' | 'rejected' | null
}

function genSessionId(): string {
  return crypto.randomUUID()
}

export function QAPage() {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const { stream, abort } = useSSE()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitDoneRef = useRef(false)
  const streamAbortedRef = useRef(false)

  const activeSession = activeSessionId ? sessions[activeSessionId] : null

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      <div className="flex-1 flex overflow-hidden w-full px-4 py-3 gap-3">

        {/* Left Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: leftPanelOpen ? '16rem' : '0px', opacity: leftPanelOpen ? 1 : 0, padding: leftPanelOpen ? '1rem' : '0', borderWidth: leftPanelOpen ? '1px' : '0' }}
        >
          {leftPanelOpen && (
            <div className="space-y-5 text-xs">
              {/* 关联主题 */}
              <div>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-cyber-blue" />
                  关联主题
                </h3>
                <div className="px-2.5 py-1.5 rounded-lg bg-cyber-blue/5 border border-cyber-blue/20 text-cyber-blue font-mono font-bold text-[11px]">
                  #qa-engine
                </div>
              </div>

              {/* 相关问题 */}
              <div className="pt-4 border-t border-gray-200/60">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 px-1 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5 text-cyber-blue" />
                  相关问题
                </h3>
                <ul className="space-y-2 text-[11px]">
                  <li>
                    <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
                      <span className="leading-snug">异步加载后如何做预热保护避免空指针？</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-green/10 text-cyber-green self-start font-bold">回答已采纳</span>
                    </button>
                  </li>
                  <li>
                    <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
                      <span className="leading-snug">全量本地内存索引会引发 OOM 溢出吗？</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-red/10 text-cyber-red self-start font-bold">待验证</span>
                    </button>
                  </li>
                </ul>
              </div>

              {/* 历史对话 */}
              <div className="pt-4 border-t border-gray-200/60">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  历史对话
                </h3>
                <div className="bg-slate-100 text-gray-900 p-2 rounded-lg font-mono text-[11px] flex justify-between items-center">
                  <span className="truncate">LSH冷启动300ms停顿</span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Center Panel */}
        <main className="flex-1 bg-white border border-gray-200/50 shadow-sm rounded-xl flex flex-col overflow-hidden relative min-w-0">

          {/* Top bar */}
          <div className="p-3 border-b border-gray-100 bg-slate-50/30 flex items-center justify-between shrink-0">
            {/* placeholder */}
          </div>

          {/* Message area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar pb-28">
            {/* placeholder */}
          </div>

          {/* Bottom input */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pointer-events-none p-3 z-10">
            {/* placeholder */}
          </div>
        </main>

        {/* Right Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: rightPanelOpen ? '450px' : '0px', opacity: rightPanelOpen ? 1 : 0, padding: rightPanelOpen ? '1rem' : '0', borderWidth: rightPanelOpen ? '1px' : '0' }}
        >
          {/* placeholder */}
        </aside>
      </div>
    </div>
  )
}
