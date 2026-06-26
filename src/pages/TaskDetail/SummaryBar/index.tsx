import { Layers, CheckCircle2, XCircle, Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { OverallMetrics } from '@/types'

interface Props {
  metrics: OverallMetrics | null
  loading: boolean
}

export function SummaryBar({ metrics, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-muted">
            <CardContent className="p-3.5">
              <div className="animate-pulse space-y-2">
                <div className="h-2.5 bg-muted rounded w-12" />
                <div className="h-6 bg-muted rounded w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!metrics) return null

  const passRate = metrics.totalLayers > 0
    ? Math.round((metrics.passedLayers / metrics.totalLayers) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Card className="border-muted">
        <CardContent className="p-2.5 flex items-center gap-2.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">总层数</p>
            <p className="font-mono text-base font-bold tabular-nums">{metrics.totalLayers}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-2.5 flex items-center gap-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-pass shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">通过</p>
            <p className="font-mono text-base font-bold tabular-nums text-pass">
              {metrics.passedLayers}
              <span className="text-xs text-muted-foreground font-normal ml-0.5">/ {metrics.totalLayers}</span>
            </p>
            <Progress value={passRate} className="h-0.5 mt-1 [&>div]:bg-pass" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-2.5 flex items-center gap-2.5">
          <XCircle className={cn('h-3.5 w-3.5 shrink-0', metrics.failedLayers > 0 ? 'text-fail' : 'text-pass')} />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">失败</p>
            <p className={cn('font-mono text-base font-bold tabular-nums', metrics.failedLayers > 0 ? 'text-fail' : 'text-pass')}>
              {metrics.failedLayers}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-2.5 flex items-center gap-2.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">平均余弦</p>
            <p className={cn('font-mono text-base font-bold tabular-nums', metrics.avgCosineSimilarity >= 0.99 ? 'text-pass' : 'text-warn')}>
              {metrics.avgCosineSimilarity.toFixed(4)}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
