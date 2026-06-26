import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { getFrameworkColor, diffToColor } from '@/utils/color'
import { formatMetricValue } from '@/utils/metric'
import { METRIC_DEFINITIONS } from '@/types'
import type { LayerDiff } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ScatterChart, Scatter, Legend,
} from 'recharts'

interface Props {
  layer: LayerDiff | null
  open: boolean
  onClose: () => void
}

export function LayerDetail({ layer, open, onClose }: Props) {
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
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {layer.layerName}
            <Badge variant="outline">{layer.layerType}</Badge>
          </SheetTitle>
          <SheetDescription>
            输入 [{layer.inputShape.join(', ')}] → 输出 [{layer.outputShape.join(', ')}]
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Per-framework metrics */}
          {layer.metrics.map((m) => (
            <div key={m.frameworkId}>
              <h4 className="text-sm font-semibold mb-3" style={{ color: getFrameworkColor(m.frameworkId) }}>
                {m.frameworkId === 'tensorrt' ? 'TensorRT' : m.frameworkId === 'openvino' ? 'OpenVINO' : m.frameworkId}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => {
                  const value = (m as any)[key] as number
                  const passed = def.higherIsBetter ? value >= def.threshold : value <= def.threshold
                  return (
                    <div
                      key={key}
                      className={cn(
                        'p-2.5 rounded-md border text-xs space-y-0.5',
                        passed ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' :
                                  'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                      )}
                    >
                      <span className="text-muted-foreground">{def.label}</span>
                      <div className="flex items-baseline gap-1">
                        <span
                          className="font-mono text-sm font-bold"
                          style={{ color: passed ? '#16a34a' : '#dc2626' }}
                        >
                          {formatMetricValue(key as any, value)}
                        </span>
                        {def.unit && <span className="text-muted-foreground">{def.unit}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Framework comparison */}
          <div>
            <h4 className="text-sm font-semibold mb-3">框架对比</h4>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 font-medium">框架</th>
                    <th className="text-right p-2 font-medium">余弦相似度</th>
                    <th className="text-right p-2 font-medium">最大误差</th>
                    <th className="text-right p-2 font-medium">信噪比</th>
                    <th className="text-center p-2 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {layer.metrics.map((m) => (
                    <tr key={m.frameworkId} className="border-t">
                      <td className="p-2">
                        <Badge variant="outline" style={{
                          borderColor: getFrameworkColor(m.frameworkId),
                          color: getFrameworkColor(m.frameworkId),
                        }}>
                          {m.frameworkId === 'tensorrt' ? 'TensorRT' : 'OpenVINO'}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-mono" style={{ color: diffToColor(m.cosineSimilarity, 0.99) }}>
                        {m.cosineSimilarity.toFixed(6)}
                      </td>
                      <td className="p-2 text-right font-mono">{m.maxAbsError.toExponential(4)}</td>
                      <td className="p-2 text-right font-mono">{m.snr.toFixed(1)} dB</td>
                      <td className="p-2 text-center">
                        {m.passed
                          ? <Badge variant="success">通过</Badge>
                          : <Badge variant="destructive">失败</Badge>
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
              <h4 className="text-sm font-semibold mb-3">输出值对比（采样）</h4>
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" fontSize={11} />
                  <YAxis domain={[-0.5, 1.5]} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Scatter name="ONNX Runtime (基准)" data={scatterData} dataKey="baseline" fill="#1677ff" line />
                  <Scatter name="对比框架" data={scatterData} dataKey="compare" fill="#ff4d4f" line />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
