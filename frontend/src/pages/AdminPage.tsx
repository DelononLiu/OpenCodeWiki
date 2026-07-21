import { useState, useEffect, useCallback } from 'react'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import { WikiConversionsCard } from '@/pages/admin/WikiConversionsCard'

export function AdminPage() {
  useSessionHistory()

  const [expandedStage, setExpandedStage] = useState<number | null>(1)
  // dummy refresh stub
  const refreshCounts = useCallback(() => {}, [])

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
              QA 对话转为结构化 Wiki 文档，自动索引供后续检索
            </p>

            <WikiConversionsCard
              expanded={expandedStage === 1}
              onToggle={() => handleStageToggle(1)}
              onUpdate={refreshCounts}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
