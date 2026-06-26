import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle } from 'lucide-react'
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
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-sm text-muted-foreground">加载任务...</p>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription className="flex items-center gap-4">
          {error}
          <Button size="sm" variant="outline" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!task) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">任务 {task.id}</h2>
            <p className="text-xs text-muted-foreground">
              {task.model.name} · {task.frameworks.filter((f) => f !== 'onnxruntime').join(', ')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <FrameworkSwitch
            frameworks={frameworkIds}
            selected={selectedFramework}
            onChange={setSelectedFramework}
          />
          {status === 'running' && (
            <Alert variant="info" className="py-1.5 px-3 text-xs">
              <AlertCircle className="h-3 w-3" />
              <AlertDescription>推理运行中 {progress}%</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* Summary */}
      <SummaryBar metrics={currentMetrics} loading={loading} />

      {/* Charts */}
      {task.comparisons.length > 0 && (
        <OverviewChart comparisons={task.comparisons} />
      )}

      {/* Layer table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">层精度对比</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LayerTable
            layers={layers}
            frameworkId={selectedFramework}
            loading={loading}
            onSelectLayer={handleSelectLayer}
            selectedLayerName={selectedLayer}
          />
        </CardContent>
      </Card>

      {/* Layer detail drawer */}
      <LayerDetail
        layer={selectedLayerData}
        open={selectedLayerData !== null}
        onClose={() => setSelectedLayer(null)}
      />
    </div>
  )
}
