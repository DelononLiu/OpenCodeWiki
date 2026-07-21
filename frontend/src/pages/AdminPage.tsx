import { useState, useEffect, useCallback } from 'react'
import { fetchQaEntries, fetchTopics, fetchReviewQueue } from '@/api/client'
import { useLayout } from '@/contexts/LayoutContext'
import { PipelineProgress } from '@/components/knowledge/PipelineProgress'
import { QaCalibrateCard } from '@/pages/admin/QaCalibrateCard'
import { TopicDiscoverCard } from '@/pages/admin/TopicDiscoverCard'
import { DraftRefineCard } from '@/pages/admin/DraftRefineCard'
import { WikiReviewCard } from '@/pages/admin/WikiReviewCard'
import type { PipelineCounts } from '@/types'

export function AdminPage() {
  const { setDrawerContent } = useLayout()
  // 清空上一页残留的抽屉内容
  useEffect(() => { setDrawerContent({ title: '', items: [] }) }, [])

  const [counts, setCounts] = useState<PipelineCounts>({
    qaPending: 0,
    unclassified: 0,
    topicDraft: 0,
    reviewQueue: 0,
  })
  const [expandedStage, setExpandedStage] = useState<number | null>(1)

  const refreshCounts = useCallback(async () => {
    try {
      const [qaData, topics, reviewData] = await Promise.all([
        fetchQaEntries({ status: 'pending', limit: 1 }),
        fetchTopics(),
        fetchReviewQueue(),
      ])
      const poolTopics = topics.filter(t => t.status === 'pool')
      setCounts({
        qaPending: qaData.total,
        unclassified: qaData.total, // rough: all pending QA are unclassified
        topicDraft: poolTopics.length,
        reviewQueue: (reviewData.queue || []).length,
      })
    } catch {}
  }, [])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts])

  const handleStageToggle = (stage: number) => {
    setExpandedStage(prev => prev === stage ? null : stage)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-lg font-bold text-gray-900">知识沉淀</h1>
            <p className="text-xs text-gray-400 -mt-2">
              QA 校准 → Topic 发现 → Draft 提炼 → Wiki 审核 → 自进化知识库
            </p>

            <PipelineProgress
              counts={counts}
              activeStage={expandedStage}
              onStageClick={handleStageToggle}
            />

            <QaCalibrateCard
              expanded={expandedStage === 1}
              onToggle={() => handleStageToggle(1)}
              onUpdate={refreshCounts}
            />

            <TopicDiscoverCard
              expanded={expandedStage === 2}
              onToggle={() => handleStageToggle(2)}
              onUpdate={refreshCounts}
            />

            <DraftRefineCard
              expanded={expandedStage === 3}
              onToggle={() => handleStageToggle(3)}
              onUpdate={refreshCounts}
            />

            <WikiReviewCard
              expanded={expandedStage === 4}
              onToggle={() => handleStageToggle(4)}
              onUpdate={refreshCounts}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
