import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
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

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted animate-pulse rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">层名</TableHead>
            <TableHead className="w-[100px]">类型</TableHead>
            <TableHead className="w-[130px] text-right">余弦相似度</TableHead>
            <TableHead className="w-[130px] text-right">最大绝对误差</TableHead>
            <TableHead className="w-[80px] text-center">结果</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedLayers.map((layer) => {
            const m = getMetric(layer)
            const isSelected = layer.layerName === selectedLayerName
            return (
              <TableRow
                key={layer.layerName}
                className={cn('cursor-pointer', isSelected && 'bg-muted')}
                onClick={() => onSelectLayer(layer)}
              >
                <TableCell className="font-medium">{layer.layerName}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{layer.layerType}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {m ? (
                    <span style={{ color: diffToColor(m.cosineSimilarity, 0.99) }}>
                      {m.cosineSimilarity.toFixed(6)}
                    </span>
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {m ? (
                    <span className={m.maxAbsError > 0.01 ? 'text-red-500' : ''}>
                      {m.maxAbsError.toExponential(4)}
                    </span>
                  ) : '-'}
                </TableCell>
                <TableCell className="text-center">
                  {m ? (
                    m.passed
                      ? <Badge variant="success">通过</Badge>
                      : <Badge variant="destructive">失败</Badge>
                  ) : '-'}
                </TableCell>
              </TableRow>
            )
          })}
          {sortedLayers.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                暂无层数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
