import { Layers, CheckCircle2, XCircle, Percent } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { OverallMetrics } from '@/types'

interface Props {
  metrics: OverallMetrics | null
  loading: boolean
}

function StatCard({ icon, label, value, colorClass, suffix }: {
  icon: React.ReactNode
  label: string
  value: string | number
  colorClass?: string
  suffix?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn('text-xl font-bold mt-0.5', colorClass)}>
              {value}
              {suffix && <span className="text-sm text-muted-foreground font-normal ml-1">{suffix}</span>}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SummaryBar({ metrics, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse space-y-2">
                <div className="h-3 bg-muted rounded w-12" />
                <div className="h-7 bg-muted rounded w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!metrics) return null

  const passRate = metrics.totalLayers > 0
    ? ((metrics.passedLayers / metrics.totalLayers) * 100).toFixed(1)
    : '0'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon={<Layers className="h-5 w-5 text-primary" />}
        label="总层数"
        value={metrics.totalLayers}
      />
      <StatCard
        icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
        label="通过"
        value={metrics.passedLayers}
        colorClass="text-green-500"
        suffix={`/ ${metrics.totalLayers}`}
      />
      <StatCard
        icon={<XCircle className={cn('h-5 w-5', metrics.failedLayers > 0 ? 'text-red-500' : 'text-green-500')} />}
        label="失败"
        value={metrics.failedLayers}
        colorClass={metrics.failedLayers > 0 ? 'text-red-500' : 'text-green-500'}
      />
      <StatCard
        icon={<Percent className="h-5 w-5 text-primary" />}
        label="平均余弦相似度"
        value={metrics.avgCosineSimilarity.toFixed(4)}
        colorClass={metrics.avgCosineSimilarity >= 0.99 ? 'text-green-500' : 'text-yellow-500'}
      />
    </div>
  )
}
