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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card className="border-muted">
        <CardContent className="p-3.5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wider font-medium">总层数</span>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums">{metrics.totalLayers}</p>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-3.5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-pass" />
            <span className="text-[11px] uppercase tracking-wider font-medium">通过</span>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-pass">
            {metrics.passedLayers}
            <span className="text-sm text-muted-foreground font-normal ml-1">/ {metrics.totalLayers}</span>
          </p>
          <Progress value={passRate} className="h-1 [&>div]:bg-pass" />
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-3.5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <XCircle className={cn('h-3.5 w-3.5', metrics.failedLayers > 0 ? 'text-fail' : 'text-pass')} />
            <span className="text-[11px] uppercase tracking-wider font-medium">失败</span>
          </div>
          <p className={cn(
            'font-mono text-xl font-bold tabular-nums',
            metrics.failedLayers > 0 ? 'text-fail' : 'text-pass'
          )}>
            {metrics.failedLayers}
          </p>
          {metrics.failedLayers > 0 && (
            <Progress value={passRate} className="h-1 [&>div]:bg-fail" />
          )}
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-3.5 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wider font-medium">平均余弦</span>
          </div>
          <p className={cn(
            'font-mono text-xl font-bold tabular-nums',
            metrics.avgCosineSimilarity >= 0.99 ? 'text-pass' : 'text-warn'
          )}>
            {metrics.avgCosineSimilarity.toFixed(4)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
