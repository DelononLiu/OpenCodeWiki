import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { Button } from '@/components/ui/button'
import { fetchQaPending, calibrateQaEntry, analyzeTopics, fetchTopics, fetchTopic, fetchTopicDraft } from '@/api/client'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import { Loader2, Sparkles, CheckCircle, FileText, Eye } from 'lucide-react'

export function AdminPage() {
  const [pendingEntries, setPendingEntries] = useState<QaEntry[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})

  useEffect(() => {
    fetchQaPending().then(setPendingEntries).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
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
    const topic = await fetchTopic(slug)
    setSelectedTopic(topic)
    const draft = await fetchTopicDraft(slug)
    setSelectedDraft(draft)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="admin" />
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar pageType="admin" />
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
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
                    <div>
                      <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                      <span className="text-xs text-gray-500 ml-2">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        t.status === 'promoted' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {t.status === 'promoted' ? '已固化' : '聚合中'}
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
        </main>
      </div>
    </div>
  )
}
