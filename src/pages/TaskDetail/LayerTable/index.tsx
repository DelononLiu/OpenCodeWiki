import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { diffToColor } from '@/utils/color'
import type { LayerDiff } from '@/types'

interface Props {
  layers: LayerDiff[]
  frameworkId: string
  loading: boolean
  onSelectLayer: (layer: LayerDiff) => void
  selectedLayerName: string | null
}

export function LayerTable({ layers, frameworkId, loading, onSelectLayer, selectedLayerName }: Props) {
  const getMetric = (layer: LayerDiff) =>
    layer.metrics.find((m) => m.frameworkId === frameworkId)

  const sortedLayers = [...layers].sort((a, b) => {
    const ma = getMetric(a)
    const mb = getMetric(b)
    return (ma?.cosineSimilarity ?? 0) - (mb?.cosineSimilarity ?? 0)
  })

  const barColor = (val: number) => {
    if (val >= 0.99) return 'bg-pass'
    if (val >= 0.95) return 'bg-warn'
    return 'bg-fail'
  }

  if (loading) {
    return (
      <div className="space-y-1 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted/50 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-muted overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-muted">
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3">层名</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-16">类型</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3">余弦相似度</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-28 text-right">最大误差</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-16 text-center">结果</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedLayers.map((layer) => {
            const m = getMetric(layer)
            const isSelected = layer.layerName === selectedLayerName
            return (
              <TableRow
                key={layer.layerName}
                className={cn(
                  'cursor-pointer border-muted transition-colors',
                  isSelected ? 'bg-accent/80' : 'hover:bg-accent/50'
                )}
                onClick={() => onSelectLayer(layer)}
              >
                <TableCell className="px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium truncate">{layer.layerName}</span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-muted-foreground/30 text-muted-foreground">
                    {layer.layerType}
                  </Badge>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {m ? (
                    <div className="flex items-center gap-2.5">
                      <Progress
                        value={m.cosineSimilarity * 100}
                        className={cn('h-1.5 flex-1 max-w-[100px] bg-muted', barColor(m.cosineSimilarity))}
                      />
                      <span
                        className="font-mono text-xs tabular-nums w-[68px] text-right shrink-0"
                        style={{ color: diffToColor(m.cosineSimilarity, 0.99) }}
                      >
                        {m.cosineSimilarity.toFixed(6)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground font-mono">—</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right">
                  {m ? (
                    <span className={cn(
                      'font-mono text-xs tabular-nums',
                      m.maxAbsError > 0.01 ? 'text-fail' : 'text-muted-foreground'
                    )}>
                      {m.maxAbsError.toExponential(4)}
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-center">
                  {m ? (
                    m.passed
                      ? <Badge variant="success" className="text-[10px] h-5 px-1.5">通过</Badge>
                      : <Badge variant="destructive" className="text-[10px] h-5 px-1.5">失败</Badge>
                  ) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
          {sortedLayers.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-10 text-xs">
                暂无层数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
