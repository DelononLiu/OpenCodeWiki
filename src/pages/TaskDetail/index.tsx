import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Space, Button, Alert, Spin } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
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

  // Reload layers when framework switches
  useEffect(() => {
    if (id && status === 'completed') {
      loadLayers(id)
    }
  }, [selectedFramework])

  const handleSelectLayer = (layer: LayerDiff) => {
    setSelectedLayer(layer.layerName)
  }

  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null
  const detailOpen = selectedLayerData !== null

  // Compute the current framework's overall metrics
  const currentMetrics: OverallMetrics | null = task?.comparisons.find(
    (c) => c.framework.value === selectedFramework
  )?.overallMetrics ?? null

  const frameworkIds = task?.frameworks.filter((f) => f !== 'onnxruntime') ?? []

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
        <p style={{ marginTop: 16, color: '#999' }}>加载任务...</p>
      </div>
    )
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="加载失败"
        description={error}
        showIcon
        action={<Button onClick={() => navigate('/')}>返回首页</Button>}
      />
    )
  }

  if (!task) return null

  return (
    <>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                任务 {task.id}
              </h2>
              <span style={{ color: '#999', fontSize: 13 }}>
                {task.model.name} · {task.frameworks.filter((f) => f !== 'onnxruntime').join(', ')}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <FrameworkSwitch
              frameworks={frameworkIds}
              selected={selectedFramework}
              onChange={setSelectedFramework}
            />
            {status === 'running' && (
              <Alert
                type="info"
                message={`推理运行中 ${progress}%`}
                showIcon
                style={{ padding: '4px 12px' }}
              />
            )}
          </div>
        </div>

        {/* Summary Bar */}
        <SummaryBar metrics={currentMetrics} loading={loading} />

        {/* Overview Charts */}
        {task.comparisons.length > 0 && (
          <OverviewChart comparisons={task.comparisons} />
        )}

        {/* Layer Table */}
        <Card title={<span style={{ fontWeight: 600 }}>层精度对比</span>} style={{ borderRadius: 8 }}>
          <LayerTable
            layers={layers}
            frameworkId={selectedFramework}
            loading={loading}
            onSelectLayer={handleSelectLayer}
            selectedLayerName={selectedLayer}
          />
        </Card>
      </Space>

      {/* Layer Detail Drawer */}
      <LayerDetail
        layer={selectedLayerData}
        open={detailOpen}
        onClose={() => setSelectedLayer(null)}
      />
    </>
  )
}
