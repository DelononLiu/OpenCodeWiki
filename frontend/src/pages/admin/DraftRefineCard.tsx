import { useState, useEffect } from 'react'
import { fetchTopics, fetchTopic, fetchTopicDraft, generateDraft, updateTopicDraft, submitDraft } from '@/api/client'
import { DraftEditor } from '@/components/knowledge/DraftEditor'
import type { Topic, TopicDraft } from '@/types'
import { Loader2, ChevronDown, ChevronRight, Send, Sparkles, Eye, PenLine } from 'lucide-react'

interface TopicDetail extends Topic {
  qa_entries?: { qid: number; question: string; answer?: string | null }[]
}

interface DraftRefineCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function DraftRefineCard({ expanded, onToggle, onUpdate }: DraftRefineCardProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState<TopicDetail | null>(null)
  const [draft, setDraft] = useState<TopicDraft | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchTopics().then(all => setTopics(all.filter(t => t.status === 'pool'))).catch(() => {})
  }, [])

  const handleSelectTopic = async (slug: string) => {
    try {
      const topic = await fetchTopic(slug) as TopicDetail
      setSelectedTopic(topic)
      const d = await fetchTopicDraft(slug)
      setDraft(d)
      setDraftContent(d?.edited_content || d?.raw_content || '')
      setFeedback(null)
    } catch {}
  }

  const handleGenerateDraft = async () => {
    if (!selectedTopic) return
    setGenerating(true)
    try {
      const result = await generateDraft(selectedTopic.slug)
      setDraft(result)
      setDraftContent(result.raw_content || '')
      setFeedback('✅ Draft 已生成，请检查并编辑后提交')
    } catch (e: any) {
      setFeedback(`❌ 生成失败: ${e.message}`)
    }
    setGenerating(false)
  }

  const handleSave = async () => {
    if (!selectedTopic) return
    setSaving(true)
    try {
      await updateTopicDraft(selectedTopic.slug, draftContent)
      setFeedback('✅ 已保存')
    } catch (e: any) {
      setFeedback(`❌ 保存失败: ${e.message}`)
    }
    setSaving(false)
  }

  const handleSubmit = async () => {
    if (!selectedTopic) return
    setSubmitting(true)
    try {
      await updateTopicDraft(selectedTopic.slug, draftContent)
      await submitDraft(selectedTopic.slug)
      setTopics(prev => prev.filter(t => t.slug !== selectedTopic.slug))
      setSelectedTopic(null)
      setDraft(null)
      setFeedback(null)
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 提交失败: ${e.message}`)
    }
    setSubmitting(false)
  }

  const pendingCount = topics.length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">③ Draft 提炼</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {pendingCount} 待提炼
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {selectedTopic ? (
            <>
              {/* Back button + topic info */}
              <div className="flex items-center justify-between">
                <button onClick={() => { setSelectedTopic(null); setDraft(null) }}
                  className="text-xs text-gray-500 hover:text-cyber-blue">← 返回 Topic 列表</button>
                <span className="text-sm font-bold text-gray-800">
                  #{selectedTopic.slug} · {selectedTopic.name}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPreviewMode(!previewMode)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-200 rounded hover:bg-gray-50">
                    {previewMode ? <PenLine className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {previewMode ? '编辑' : '预览'}
                  </button>
                </div>
              </div>

              {previewMode ? (
                <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm prose prose-slate max-w-none whitespace-pre-wrap">
                  {draftContent || '(空内容)'}
                </div>
              ) : (
                <DraftEditor
                  qaEntries={selectedTopic.qa_entries || []}
                  draftContent={draftContent}
                  onChange={setDraftContent}
                />
              )}

              {feedback && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  feedback.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'
                }`}>
                  {feedback}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button onClick={handleGenerateDraft} disabled={generating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-cyber-blue/30 text-cyber-blue rounded-lg hover:bg-cyber-blue/5 disabled:opacity-50">
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {draft ? '重新生成' : '生成 Draft'}
                </button>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving || !draftContent}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    保存
                  </button>
                  <button onClick={handleSubmit} disabled={submitting || !draftContent}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-cyber-blue text-white text-xs rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    提交审核
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {topics.map(t => (
                <button key={t.slug} onClick={() => handleSelectTopic(t.slug)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                    <span className="text-xs text-gray-500">{t.name}</span>
                    {t.qa_count != null && (
                      <span className="text-[10px] text-gray-400 bg-white px-1.5 py-0.5 rounded">{t.qa_count} QA</span>
                    )}
                  </div>
                  <span className="text-[10px] text-cyber-blue font-bold">编辑 →</span>
                </button>
              ))}
              {topics.length === 0 && (
                <div className="text-center text-gray-400 py-4 text-sm">
                  暂无待提炼的 Topic，请先在阶段②中生成
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
