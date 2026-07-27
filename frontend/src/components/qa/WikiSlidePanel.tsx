import { useState } from 'react'
import { X, Library } from 'lucide-react'

interface WikiSlidePanelProps {
  open: boolean
  onClose: () => void
  question: string
  answer: string
  onSuccess: () => void
}

const MOCK_KNOWLEDGE_BASES = [
  { id: 'kb-main', name: 'OpenCodeWiki' },
  { id: 'kb-tech', name: '技术文档库' },
  { id: 'kb-arch', name: '架构设计库' },
]

export function WikiSlidePanel({ open, onClose, question, answer, onSuccess }: WikiSlidePanelProps) {
  const [selectedKB, setSelectedKB] = useState(MOCK_KNOWLEDGE_BASES[0].id)
  const [path, setPath] = useState('/')
  const [content, setContent] = useState(answer)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    await new Promise(resolve => setTimeout(resolve, 800))
    setSubmitting(false)
    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      onSuccess()
    }, 1500)
  }

  if (!open) return null

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity duration-300"
        onClick={onClose}
      />

      {/* 滑出面板 */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out translate-x-0 flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Library className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-800">沉淀到 Wiki</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 关联问题 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">问题</label>
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              {question}
            </p>
          </div>

          {/* 知识库选择 — 下拉列表 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">目标知识库</label>
            <select
              value={selectedKB}
              onChange={e => setSelectedKB(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 focus:border-cyber-blue/40"
              disabled={submitting || success}
            >
              {MOCK_KNOWLEDGE_BASES.map(kb => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))}
            </select>
          </div>

          {/* 目录路径 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">目录路径</label>
            <input
              type="text"
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/ 或 /guides/"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 focus:border-cyber-blue/40"
              disabled={submitting || success}
            />
          </div>

          {/* 内容预览编辑区 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">内容（可编辑）</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={12}
              className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 focus:border-cyber-blue/40 resize-y"
              disabled={submitting || success}
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          {success ? (
            <div className="text-center text-sm font-medium text-emerald-500 py-2">
              已成功沉淀到 Wiki
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                disabled={submitting}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !content.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '提交中...' : '确认沉淀'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
