import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getFrameworkColor, diffToColor } from '@/utils/color'
import { formatMetricValue } from '@/utils/metric'
import { METRIC_DEFINITIONS } from '@/types'
import type { LayerDiff } from '@/types'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Props {
  layer: LayerDiff | null
  onClose: () => void
}

function CosineBar({ value }: { value: number }) {
  const color = value >= 0.99 ? 'bg-pass' : value >= 0.95 ? 'bg-warn' : 'bg-fail'
  return (
    <div className="flex items-center gap-2">
      <Progress value={value * 100} className={cn('h-2 flex-1 bg-muted', color)} />
      <span className="font-mono text-xs tabular-nums w-16 text-right" style={{ color: diffToColor(value, 0.99) }}>
        {value.toFixed(6)}
      </span>
    </div>
  )
}

export function LayerDetail({ layer, onClose }: Props) {
  if (!layer) return null

  const generateComparisonData = (cosineSimilarity: number) => {
    return Array.from({ length: 50 }, (_, i) => ({
      x: i,
      baseline: Math.sin(i * 0.3) + 0.5,
      compare: Math.sin(i * 0.3 + (1 - cosineSimilarity) * 2) + 0.5,
    }))
  }

  const mainMetric = layer.metrics[0]
  const scatterData = mainMetric ? generateComparisonData(mainMetric.cosineSimilarity) : []

  return (
    <div className="w-[400px] shrink-0 border-l border-muted bg-card overflow-y-auto">
      <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-4 py-3 border-b border-muted">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm font-semibold truncate">{layer.layerName}</span>
          <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 shrink-0">
            {layer.layerType}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="p-4 space-y-5">
        {/* Shape info */}
        <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded-md p-2.5">
          <span>输入 [{layer.inputShape.join(', ')}]</span>
          <span className="mx-2 text-muted-foreground/50">→</span>
          <span>输出 [{layer.outputShape.join(', ')}]</span>
        </div>

        {/* Per-framework metrics */}
        {layer.metrics.map((m) => (
          <div key={m.frameworkId}>
            <h4 className="text-xs font-semibold mb-2.5 flex items-center gap-2" style={{ color: getFrameworkColor(m.frameworkId) }}>
              <span className="w-2 h-2 rounded-full" style={{ background: getFrameworkColor(m.frameworkId) }} />
              {m.frameworkId === 'tensorrt' ? 'TensorRT' : 'OpenVINO'}
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => {
                const value = (m as any)[key] as number
                const passed = def.higherIsBetter ? value >= def.threshold : value <= def.threshold
                return (
                  <div
                    key={key}
                    className={cn(
                      'p-2 rounded-md border text-xs',
                      passed ? 'border-pass/20 bg-pass/5' : 'border-fail/20 bg-fail/5'
                    )}
                  >
                    <div className="text-muted-foreground text-[10px] mb-0.5">{def.label}</div>
                    <div className="flex items-baseline gap-1">
                      <span
                        className="font-mono text-sm font-bold tabular-nums"
                        style={{ color: passed ? '#22c55e' : '#ef4444' }}
                      >
                        {formatMetricValue(key as any, value)}
                      </span>
                      {def.unit && <span className="text-muted-foreground text-[10px]">{def.unit}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Framework comparison */}
        <div>
          <h4 className="text-xs font-semibold mb-2.5 text-muted-foreground uppercase tracking-wider">框架对比</h4>
          <div className="rounded-md border border-muted overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2 font-medium text-muted-foreground text-[10px] uppercase">框架</th>
                  <th className="p-2 font-medium text-muted-foreground text-[10px] uppercase">余弦相似度</th>
                  <th className="text-right p-2 font-medium text-muted-foreground text-[10px] uppercase">最大误差</th>
                  <th className="text-center p-2 font-medium text-muted-foreground text-[10px] uppercase">结果</th>
                </tr>
              </thead>
              <tbody>
                {layer.metrics.map((m) => (
                  <tr key={m.frameworkId} className="border-t border-muted">
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px] font-mono" style={{
                        borderColor: getFrameworkColor(m.frameworkId),
                        color: getFrameworkColor(m.frameworkId),
                      }}>
                        {m.frameworkId === 'tensorrt' ? 'TRT' : 'OV'}
                      </Badge>
                    </td>
                    <td className="p-2 min-w-[120px]">
                      <CosineBar value={m.cosineSimilarity} />
                    </td>
                    <td className="p-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {m.maxAbsError.toExponential(4)}
                    </td>
                    <td className="p-2 text-center">
                      {m.passed
                        ? <Badge variant="success" className="text-[10px]">通过</Badge>
                        : <Badge variant="destructive" className="text-[10px]">失败</Badge>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Output comparison chart */}
        {scatterData.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2.5 text-muted-foreground uppercase tracking-wider">输出值对比（采样）</h4>
            <ResponsiveContainer width="100%" height={160}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="x" fontSize={10} tick={{ fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis domain={[-0.5, 1.5]} fontSize={10} tick={{ fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 6, fontSize: 11 }}
                />
                <Scatter name="基准" data={scatterData} dataKey="baseline" fill="#1677ff" />
                <Scatter name="对比" data={scatterData} dataKey="compare" fill="#ef4444" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
