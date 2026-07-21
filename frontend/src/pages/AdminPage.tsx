import { useState, useEffect } from 'react'
import { fetchQaEntries, calibrateQaEntry, fetchTopics, fetchTopic, fetchTopicDraft, fetchWikiModules, publishTopic, updateTopicDraft } from '@/api/client'
import { useLayout } from '@/contexts/LayoutContext'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import { Loader2, CheckCircle, Eye, ArrowUpCircle, BookOpen } from 'lucide-react'

interface TopicDetail extends Topic {
  qa_entries?: { qid: number; question: string }[]
}

export function AdminPage() {
  const [pendingQa, setPendingQa] = useState<QaEntry[]>([])
  const [poolTopics, setPoolTopics] = useState<Topic[]>([])
  const [pendingCounts, setPendingCounts] = useState({ qa: 0, topic: 0, wiki: 0, repo: 0 })
  const { setDrawerContent } = useLayout()

  // Set drawer content (知识沉淀子项)
  useEffect(() => {
    setDrawerContent({
      title: '知识沉淀',
      items: [
        { id: 'qa-cal', label: `⏳ QA 校准${pendingCounts.qa > 0 ? ` (${pendingCounts.qa})` : ''}`, active: false, onClick: () => setCurrentView('qa') },
        { id: 'topic-sug', label: `📝 Topic 建议${pendingCounts.topic > 0 ? ` (${pendingCounts.topic})` : ''}`, active: false, onClick: () => setCurrentView('topic') },
        { id: 'wiki-chg', label: `📖 Wiki 变动${pendingCounts.wiki > 0 ? ` (${pendingCounts.wiki})` : ''}`, active: false, onClick: () => setCurrentView('wiki') },
      ],
    })
  }, [pendingCounts])

  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedModule, setSelectedModule] = useState('')

  const [currentView, setCurrentView] = useState<'qa' | 'topic' | 'wiki'>('qa')
  const [previewMode, setPreviewMode] = useState(false)
  const [editableContent, setEditableContent] = useState('')
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)

  useEffect(() => {
    fetchQaEntries({ status: 'pending', limit: 50 }).then(d => { setPendingQa(d.entries); setPendingCounts(prev => ({ ...prev, qa: d.total })) }).catch(() => {})
    fetchTopics().then(d => { const pool = d.filter(t => t.status === 'pool'); setPoolTopics(pool); setPendingCounts(prev => ({ ...prev, topic: pool.length })) }).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    await calibrateQaEntry(qid, answer)
    setPendingQa(prev => prev.filter(e => e.qid !== qid))
  }

  const handleViewTopic = async (slug: string) => {
    setPublishResult(null)
    try {
      const topic = await fetchTopic(slug) as TopicDetail
      setSelectedTopic(topic)
      const draft = await fetchTopicDraft(slug)
      setSelectedDraft(draft)
      setEditableContent(draft?.edited_content || draft?.raw_content || '')
      if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].slug)
    } catch {}
  }

  const handlePublish = async () => {
    if (!selectedTopic || !selectedModule) return
    setPublishing(true)
    try {
      if (editableContent) await updateTopicDraft(selectedTopic.slug, editableContent)
      await publishTopic(selectedTopic.slug, selectedModule)
      setPublishResult('✅ 沉淀成功！Topic 已写入 Wiki')
      const updated = await fetchTopics()
      setPoolTopics(updated.filter(t => t.status === 'pool'))
    } catch (e: any) {
      setPublishResult(`❌ 沉淀失败: ${e.message}`)
    }
    setPublishing(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">

        {/* 主内容 */}
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          {selectedTopic ? (
            <div className="max-w-6xl mx-auto space-y-6">
              <button onClick={() => { setSelectedTopic(null); setSelectedDraft(null) }}
                className="text-xs text-gray-500 hover:text-cyber-blue">← 返回审核列表</button>
              <h2 className="text-lg font-bold text-gray-900">#{selectedTopic.slug} · {selectedTopic.name}</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">💧 液态原始 — 关联问答</h3>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {(selectedTopic as TopicDetail).qa_entries?.map(qa => (
                      <div key={qa.qid} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                        <span className="font-mono text-cyber-blue font-bold text-[10px]">#Q{qa.qid}</span>
                        <span className="ml-1.5 font-medium text-gray-800">{qa.question}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">🧊 固态提炼</h3>
                  <textarea value={editableContent} onChange={e => setEditableContent(e.target.value)}
                    rows={15} className="w-full text-sm border border-gray-200 rounded-lg p-3 font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
                    placeholder="编辑提炼稿..." />
                </div>
              </div>
              {previewMode && editableContent && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm prose prose-slate max-w-none whitespace-pre-wrap mt-3">
                  {editableContent}
                </div>
              )}
              <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-400" />
                  <span className="text-xs text-gray-600">目标模块:</span>
                  <select value={selectedModule} onChange={e => setSelectedModule(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                    {modules.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                  </select>
                </div>
                {publishResult && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${publishResult.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'}`}>
                    {publishResult}
                  </div>
                )}
                <button onClick={() => setPreviewMode(!previewMode)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  {previewMode ? '关闭预览' : '预览效果'}
                </button>
                <button onClick={handlePublish} disabled={!selectedModule || publishing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyber-blue text-white text-sm rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                  {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                  沉淀为 Wiki
                </button>
              </div>
            </div>
          ) : currentView === 'qa' ? (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-gray-900">⏳ QA 校准</h2>
              {pendingQa.map(e => (
                <div key={e.qid} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyber-blue font-bold">#Q{e.qid}</span>
                    <span className="text-sm font-medium">{e.question}</span>
                  </div>
                  <textarea value={calAnswers[e.qid] ?? ''} onChange={evt => setCalAnswers(prev => ({ ...prev, [e.qid]: evt.target.value }))}
                    placeholder="输入校准答案..." rows={3}
                    className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => window.open(`/qa?qid=${e.qid}`, '_blank')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                      <Eye className="w-3 h-3" /> 查看
                    </button>
                    <button onClick={() => handleCalibrate(e.qid)} disabled={!calAnswers[e.qid]?.trim()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                      <CheckCircle className="w-3 h-3" /> 校准
                    </button>
                  </div>
                </div>
              ))}
              {pendingQa.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">✅ 暂无待审核条目</div>}
            </div>
          ) : currentView === 'topic' ? (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-gray-900">📝 Topic 聚合</h2>
              {poolTopics.map(t => (
                <button key={t.slug} onClick={() => handleViewTopic(t.slug)}
                  className="w-full bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                    <span className="text-xs text-gray-500">{t.name}</span>
                    {t.qa_count != null && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{t.qa_count} QA</span>}
                  </div>
                  <span className="text-[10px] text-cyber-blue font-bold">查看详情 →</span>
                </button>
              ))}
              {poolTopics.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">暂无聚合中的 Topic</div>}
            </div>
          ) : currentView === 'wiki' ? (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-gray-900">📖 Wiki 变动</h2>
              <div className="text-center text-gray-400 py-8 text-sm">暂无待审核的 Wiki 变动</div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
