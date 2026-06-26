import { useState, useEffect } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getTask, getTaskLayers } from '@/api/task'
import { OverviewChart } from '@/pages/TaskDetail/OverviewChart'
import { LayerTable } from '@/pages/TaskDetail/LayerTable'
import type { ComparisonTask, LayerDiff, LayerMetric } from '@/types'
import { formatSize, extractArch, mockParams } from './utils'
import { MOCK_LAYERS_ALL_PASS, MOCK_LAYERS_HAS_FAIL, buildMockTask } from './mockData'
import { TaskHistoryDrawer } from '@/core/components/TaskHistoryDrawer'
import { TopNav } from '@/core/components/TopNav'

interface Props {
  taskId: string
  onNewTask: () => void
}

const FW_OPTIONS = [
  { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
]

export function ModelDiffResult({ taskId, onNewTask }: Props) {
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [layers, setLayers] = useState<LayerDiff[]>([])
  const [layersLoading, setLayersLoading] = useState(true)
  const [selectedFramework, setSelectedFramework] = useState('tensorrt')
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null

  useEffect(() => {
    const useMock = import.meta.env.VITE_USE_MOCK !== 'false'
    if (useMock) {
      if (taskId === 'mock-resnet50_v1') {
        setTask(buildMockTask('resnet50_v1', 'completed', 3, 3))
        setLayers(MOCK_LAYERS_ALL_PASS)
        setSelectedLayer(null)
      } else if (taskId === 'mock-yolov8_test') {
        setTask(buildMockTask('yolov8_test', 'completed', 2, 3))
        setLayers(MOCK_LAYERS_HAS_FAIL)
        setSelectedLayer('conv_23')
      } else {
        setTask(buildMockTask('bert_base_eval', 'failed', 0, 0))
        setLayers([])
        setSelectedLayer(null)
      }
      setLayersLoading(false)
      return
    }

    loadRealTask(taskId)
  }, [taskId])

  async function loadRealTask(tid: string) {
    try {
      const t = await getTask(tid)
      setTask(t)
      const rawLayers = await getTaskLayers(tid)
      setLayers(rawLayers)
      const failed = rawLayers.find((l: any) => l.metrics?.some((m: any) => !m.passed))
      setSelectedLayer(failed?.layerName ?? null)
    } catch (e) {
      console.error('load task failed', e)
    } finally {
      setLayersLoading(false)
    }
  }

  if (!task) return null

  return (
    <div className="h-screen flex flex-col">
      <TopNav
        title={`task_${task.model?.name ?? taskId.slice(0, 8)}`}
        subtitle={task.model?.name}
        showNewTask
        onNewTask={onNewTask}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <div className="flex-1 flex min-h-0 bg-muted/30">
        <div className={cn(
          'flex-1 min-w-0 overflow-y-auto p-5 space-y-4',
          selectedLayerData && 'pr-0'
        )}>
          {/* Select framework */}
          <div className="flex items-center justify-end">
            <Select value={selectedFramework} onValueChange={(v) => { setSelectedFramework(v); setSelectedLayer(null) }}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(task.frameworks ?? []).filter((f: string) => f !== 'onnxruntime').map((fw: string) => {
                  const cfg = FW_OPTIONS.find((o) => o.value === fw)
                  return (
                    <SelectItem key={fw} value={fw} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg?.color }} />
                        {cfg?.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Model Info */}
          {task && (
            <div className="rounded-lg border border-muted bg-card">
              <div className="px-3.5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted">模型信息</div>
              <div className="grid grid-cols-5 divide-x divide-muted text-[11px]">
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">架构</p>
                  <p className="font-medium text-foreground">{extractArch(task.model?.name ?? '')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">参数量</p>
                  <p className="font-medium text-foreground">{mockParams(task.model?.name ?? '')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">框架</p>
                  <p className="font-mono text-foreground">{(task.frameworks ?? []).filter((f: string) => f !== 'onnxruntime').join(' + ')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">硬件</p>
                  <p className="font-medium text-foreground">NVIDIA CUDA 12.1</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">文件</p>
                  <p className="font-mono text-xs text-foreground">{task.model?.name ?? '—'}</p>
                  <p className="text-muted-foreground/60">{task.model ? formatSize(task.model.size) : ''}</p>
                </div>
              </div>
            </div>
          )}

          {/* Layer Cosine + Radar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-muted bg-card">
              <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                层输出余弦（倒序）
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {layers.length === 0 && <p className="text-[11px] text-muted-foreground/60 py-1">无数据</p>}
                {[...layers]
                  .sort((a, b) => {
                    const ma = a.metrics.find((m: LayerMetric) => m.frameworkId === selectedFramework)
                    const mb = b.metrics.find((m: LayerMetric) => m.frameworkId === selectedFramework)
                    return (ma?.cosineSimilarity ?? 1) - (mb?.cosineSimilarity ?? 1)
                  })
                  .map((l) => {
                    const m = l.metrics.find((m: LayerMetric) => m.frameworkId === selectedFramework)
                    if (!m) return null
                    return (
                      <button key={l.layerName} onClick={() => setSelectedLayer(l.layerName)}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors text-left',
                          selectedLayer === l.layerName ? 'bg-accent' : 'hover:bg-accent/50'
                        )}>
                        <span className="text-[11px] font-mono text-muted-foreground truncate">{l.layerName}</span>
                        <span className={cn('font-mono text-xs font-bold tabular-nums shrink-0', m.passed ? 'text-pass' : 'text-fail')}>
                          {m.cosineSimilarity.toFixed(4)}
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>

            {/* Radar Chart */}
            {task.comparisons && task.comparisons.length > 0 && (
              <OverviewChart comparisons={task.comparisons} />
            )}
          </div>

          {/* Layer Table */}
          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
              全量网络层明细
              <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">({layers.length} layers)</span>
            </div>
            <LayerTable
              layers={layers}
              frameworkId={selectedFramework}
              loading={layersLoading}
              onSelectLayer={(l) => setSelectedLayer(l.layerName)}
              selectedLayerName={selectedLayer}
            />
          </div>
        </div>

        {/* Right panel */}
        {selectedLayerData && (
          <div className="w-[380px] shrink-0 border-l border-muted overflow-y-auto">
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-4 py-2.5 border-b border-muted">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-sm font-semibold truncate">{selectedLayerData.layerName}</span>
                <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 shrink-0">
                  {selectedLayerData.layerType}
                </Badge>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setSelectedLayer(null)}>✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded-md p-2.5">
                输入 [{selectedLayerData.inputShape.join(', ')}] → 输出 [{selectedLayerData.outputShape.join(', ')}]
              </div>
              {selectedLayerData.metrics.map((m) => {
                const cfg = FW_OPTIONS.find((o) => o.value === m.frameworkId)
                return (
                  <div key={m.frameworkId}>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: cfg?.color }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: cfg?.color }} />
                      {cfg?.label}
                    </h4>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { key: 'cosineSimilarity', label: '余弦相似度', val: m.cosineSimilarity },
                        { key: 'maxAbsError', label: '最大绝对误差', val: m.maxAbsError },
                        { key: 'meanAbsError', label: '平均绝对误差', val: m.meanAbsError },
                        { key: 'snr', label: '信噪比', val: m.snr, unit: 'dB' },
                      ].map((item) => {
                        const val = item.val as number
                        const passed = item.key === 'cosineSimilarity' || item.key === 'snr'
                          ? val >= (item.key === 'cosineSimilarity' ? 0.99 : 20)
                          : val <= (item.key === 'maxAbsError' ? 0.01 : 0.005)
                        return (
                          <div key={item.key}
                            className={cn('p-2 rounded-md border text-xs', passed ? 'border-pass/20 bg-pass/5' : 'border-fail/20 bg-fail/5')}>
                            <div className="text-muted-foreground text-[10px] mb-0.5">{item.label}</div>
                            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: passed ? '#22c55e' : '#ef4444' }}>
                              {item.key === 'cosineSimilarity' ? val.toFixed(6) : val.toExponential(4)}
                              {item.unit && <span className="text-muted-foreground text-[10px] font-normal ml-0.5">{item.unit}</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <TaskHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} onSelect={(id) => {
        loadRealTask(id)
      }} />
    </div>
  )
}
