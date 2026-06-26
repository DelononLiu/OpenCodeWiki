import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTaskStore } from '@/stores/taskStore'
import { SummaryBar } from './SummaryBar'
import { OverviewChart } from './OverviewChart'
import { LayerTable } from './LayerTable'
import { LayerDetail } from './LayerDetail'
import { FrameworkSwitch } from './FrameworkSwitch'
import type { LayerDiff, OverallMetrics } from '@/types'

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const {
    task,
    layers,
    status,
    progress,
    selectedLayer,
    selectedFramework,
    pollTask,
    loadLayers,
    setSelectedLayer,
    setSelectedFramework,
  } = useTaskStore()

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    const load = async () => {
      try {
        await pollTask(id)
        await loadLayers(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  useEffect(() => {
    if (id && status === 'completed') {
      loadLayers(id)
    }
  }, [selectedFramework])

  const handleSelectLayer = (layer: LayerDiff) => {
    setSelectedLayer(layer.layerName)
  }

  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null
  const currentMetrics: OverallMetrics | null = task?.comparisons.find(
    (c) => c.framework.value === selectedFramework
  )?.overallMetrics ?? null
  const frameworkIds = task?.frameworks.filter((f) => f !== 'onnxruntime') ?? []

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">加载任务...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm">加载失败</AlertTitle>
          <AlertDescription className="flex items-center gap-3 text-xs">
            {error}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/')}>
              返回首页
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!task) return null

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/')}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{task.id}</h2>
                {status === 'running' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    推理运行中 {progress}%
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                {task.model.name}
                <span className="mx-1.5 text-muted-foreground/50">·</span>
                {task.frameworks.filter((f) => f !== 'onnxruntime').join(', ')}
              </p>
            </div>
          </div>

          <FrameworkSwitch
            frameworks={frameworkIds}
            selected={selectedFramework}
            onChange={setSelectedFramework}
          />
        </div>

        {/* Summary */}
        <SummaryBar metrics={currentMetrics} loading={loading} />

        {/* Charts */}
        {task.comparisons.length > 0 && (
          <OverviewChart comparisons={task.comparisons} />
        )}

        {/* Layer table */}
        <Card className="border-muted">
          <CardHeader className="pb-0 pt-3 px-3">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              层精度对比
              <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">({layers.length} layers)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-1">
            <LayerTable
              layers={layers}
              frameworkId={selectedFramework}
              loading={loading}
              onSelectLayer={handleSelectLayer}
              selectedLayerName={selectedLayer}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right detail panel (PC: inline, not drawer) */}
      {selectedLayerData && (
        <LayerDetail
          layer={selectedLayerData}
          onClose={() => setSelectedLayer(null)}
        />
      )}
    </div>
  )
}
