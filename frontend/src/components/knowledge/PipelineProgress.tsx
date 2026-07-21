import type { PipelineCounts } from '@/types'

interface PipelineProgressProps {
  counts: PipelineCounts
  activeStage: number | null
  onStageClick: (stage: number) => void
}

const STAGES = [
  { num: 1, label: 'QA 校准', countKey: 'qaPending' as const },
  { num: 2, label: 'Topic 发现', countKey: 'unclassified' as const },
  { num: 3, label: 'Draft 提炼', countKey: 'topicDraft' as const },
  { num: 4, label: 'Wiki 审核', countKey: 'reviewQueue' as const },
]

export function PipelineProgress({ counts, activeStage, onStageClick }: PipelineProgressProps) {
  const total = (counts.qaPending > 0 ? 1 : 0) +
    (counts.unclassified > 0 ? 1 : 0) +
    (counts.topicDraft > 0 ? 1 : 0) +
    (counts.reviewQueue > 0 ? 1 : 0)
  const pct = total > 0 ? Math.round((total / 4) * 100) : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-700">知识沉淀进度</span>
        <span className="text-[10px] text-gray-400">{pct}%</span>
      </div>
      <div className="flex gap-1 mb-3">
        {STAGES.map(s => (
          <div
            key={s.num}
            className={`h-1.5 flex-1 rounded-full transition ${
              counts[s.countKey] === 0 ? 'bg-gray-200' :
              activeStage === s.num ? 'bg-cyber-blue' : 'bg-cyber-blue/30'
            }`}
          />
        ))}
      </div>
      <div className="flex gap-2">
        {STAGES.map(s => (
          <button
            key={s.num}
            onClick={() => onStageClick(s.num)}
            className={`flex-1 text-center px-2 py-1.5 rounded-lg text-[10px] font-bold transition ${
              activeStage === s.num
                ? 'bg-cyber-blue/10 text-cyber-blue'
                : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            }`}
          >
            {s.label}
            {counts[s.countKey] > 0 && (
              <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 text-[9px]">
                {counts[s.countKey]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
