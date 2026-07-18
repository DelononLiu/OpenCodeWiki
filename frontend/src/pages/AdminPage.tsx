import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { Button } from '@/components/ui/button'
import {
  fetchQaPending, calibrateQaEntry, analyzeTopics, fetchTopics,
  fetchTopic, fetchTopicDraft, fetchWikiModules, publishTopic,
  updateTopicDraft,
} from '@/api/client'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import {
  Loader2, Sparkles, CheckCircle, Eye, FileText,
  ArrowUpCircle, BookOpen,
} from 'lucide-react'

export function AdminPage() {
  const [pendingEntries, setPendingEntries] = useState<QaEntry[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})

  // Topic detail panel
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [topicQaEntries, setTopicQaEntries] = useState<QaEntry[]>([])
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedModule, setSelectedModule] = useState('')
  const [editableContent, setEditableContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)

  useEffect(() => {
    fetchQaPending().then(setPendingEntries).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      await analyzeTopics()
      const updated = await fetchTopics()
      setTopics(updated)
    } catch {}
    setAnalyzing(false)
  }

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    await calibrateQaEntry(qid, answer)
    setPendingEntries(prev => prev.filter(e => e.qid !== qid))
  }

  const handleViewTopic = async (slug: string) => {
    setPublishResult(null)
    setPreviewMode(false)
    try {
      const topic = await fetchTopic(slug)
      setSelectedTopic(topic)
      setTopicQaEntries((topic as any).qa_entries || [])

      const draft = await fetchTopicDraft(slug)
      setSelectedDraft(draft)
      setEditableContent(draft?.edited_content || draft?.raw_content || '')

      // Auto-select first module
      if (modules.length > 0 && !selectedModule) {
        setSelectedModule(modules[0].slug)
      }
    } catch {}
  }

  const handlePublish = async () => {
    if (!selectedTopic || !selectedModule) return
    setPublishing(true)
    try {
      // Save draft content first
      if (editableContent) {
        await updateTopicDraft(selectedTopic.slug, editableContent)
      }
      await publishTopic(selectedTopic.slug, selectedModule)
      setPublishResult('✅ 沉淀成功！Topic 已写入 wiki')
      // Refresh topic list
      const updated = await fetchTopics()
      setTopics(updated)
    } catch (e: any) {
      setPublishResult(`❌ 沉淀失败: ${e.message}`)
    }
    setPublishing(false)
  }

  const closeDetail = () => {
    setSelectedTopic(null)
    setSelectedDraft(null)
    setTopicQaEntries([])
    setEditableContent('')
    setPublishResult(null)
    setPreviewMode(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="admin" />
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar pageType="admin" />
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          {/* ── Topic Detail Panel ── */}
          {selectedTopic ? (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Back button + header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={closeDetail}>← 返回</Button>
                  <h2 className="text-lg font-bold text-gray-900">#{selectedTopic.slug}</h2>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    selectedTopic.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {selectedTopic.status === 'published' ? '已沉淀' : '聚合中'}
                  </span>
                </div>
              </div>

              {/* Side-by-side: Raw QA vs Refined Draft */}
              <div className="grid grid-cols-2 gap-6">
                {/* Left: Raw QA (Liquid) */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    💧 液态原始 — 关联问答
                  </h3>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                    {topicQaEntries.map((qa: any) => (
                      <div key={qa.qid} className="bg-white border border-gray-200 rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-cyber-blue font-bold text-[10px]">#Q{qa.qid}</span>
                          <span className="font-medium text-gray-800">{qa.question}</span>
                        </div>
                        {qa.answer && (
                          <div className="text-gray-500 border-t border-gray-100 pt-1.5 mt-1.5 whitespace-pre-wrap text-[11px] font-mono">
                            {qa.answer.slice(0, 200)}{qa.answer.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                    {topicQaEntries.length === 0 && (
                      <div className="text-gray-400 text-sm py-8 text-center">暂无关联问答</div>
                    )}
                  </div>
                </div>

                {/* Right: Refined Draft (Solid) */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider flex items-center gap-1.5">
                    🧊 固态提炼 — 编辑稿
                  </h3>
                  <textarea
                    value={editableContent}
                    onChange={e => setEditableContent(e.target.value)}
                    rows={15}
                    className="w-full text-sm border border-gray-200 rounded-lg p-3 font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
                    placeholder="输入或编辑提炼稿..."
                  />
                  {previewMode && editableContent && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm prose prose-slate max-w-none whitespace-pre-wrap">
                      {editableContent}
                    </div>
                  )}
                </div>
              </div>

              {/* Module Selector + Action Bar */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-600 font-medium">目标模块:</span>
                  </div>
                  <select
                    value={selectedModule}
                    onChange={e => setSelectedModule(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                  >
                    <option value="">-- 选择模块 --</option>
                    {modules.map(m => (
                      <option key={m.slug} value={m.slug}>
                        {m.type === 'directory' ? '📁 ' : '📄 '}{m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {publishResult && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${publishResult.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'}`}>
                    {publishResult}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setPreviewMode(!previewMode)} disabled={!editableContent}>
                    <Eye className="w-3.5 h-3.5 mr-1" /> {previewMode ? '关闭预览' : '预览 wiki 效果'}
                  </Button>
                  <Button size="sm" onClick={handlePublish} disabled={!selectedModule || publishing || selectedTopic.status === 'published'}>
                    {publishing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5 mr-1.5" />}
                    {publishing ? '沉淀中...' : (selectedTopic.status === 'published' ? '已沉淀' : '沉淀为 Wiki')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Topic List + Pending QA ── */
            <div className="max-w-5xl mx-auto space-y-8">
              {/* Pending QA */}
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-4">⏳ 待审条目</h2>
                <div className="space-y-3">
                  {pendingEntries.map(entry => (
                    <div key={entry.qid} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-cyber-blue font-bold">#Q{entry.qid}</span>
                        <span className="text-sm font-medium">{entry.question}</span>
                      </div>
                      <textarea
                        value={calAnswers[entry.qid] ?? ''}
                        onChange={evt => setCalAnswers(prev => ({ ...prev, [entry.qid]: evt.target.value }))}
                        placeholder="输入校准答案..."
                        rows={3}
                        className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => window.open(`/qa?qid=${entry.qid}`, '_blank')}>
                          <Eye className="w-3.5 h-3.5 mr-1" /> 查看
                        </Button>
                        <Button size="sm" onClick={() => handleCalibrate(entry.qid)} disabled={!calAnswers[entry.qid]?.trim()}>
                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> 校准
                        </Button>
                      </div>
                    </div>
                  ))}
                  {pendingEntries.length === 0 && (
                    <div className="text-center text-gray-400 py-8 text-sm">✅ 暂无待审核条目</div>
                  )}
                </div>
              </div>

              {/* Topic Analysis */}
              <div className="border-t border-gray-200 pt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900">🧠 Topic 聚合</h2>
                  <Button onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
                    分析 QA 池
                  </Button>
                </div>
                <div className="grid gap-3">
                  {topics.map(t => (
                    <div key={t.slug}
                      className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-cyber-blue/30 transition"
                      onClick={() => handleViewTopic(t.slug)}>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                        <span className="text-xs text-gray-500">{t.name}</span>
                        {t.qa_count != null && (
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{t.qa_count} 条 QA</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          t.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                        }`}>
                          {t.status === 'published' ? '已沉淀' : '聚合中'}
                        </span>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewTopic(t.slug) }}>
                          <FileText className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {topics.length === 0 && (
                    <div className="text-center text-gray-400 py-8 text-sm">暂无 Topic，点击"分析 QA 池"生成</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
