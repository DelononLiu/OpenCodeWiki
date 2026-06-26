import { useState, useRef, useCallback } from 'react'
import { Upload, FileIcon, Loader2, Plus, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { uploadModel } from '@/api/model'
import { createTask, getTask, getTaskLayers } from '@/api/task'
import { SummaryBar } from '@/pages/TaskDetail/SummaryBar'
import { OverviewChart } from '@/pages/TaskDetail/OverviewChart'
import { LayerTable } from '@/pages/TaskDetail/LayerTable'
import { useUIStore } from '@/stores/uiStore'
import type { ModelFile, ComparisonTask, LayerDiff, OverallMetrics } from '@/types'

type PageState = 'entry' | 'analysis'
type BoxState = 'empty' | 'config' | 'running'

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// ─── Mock recent tasks ─────────────────────────────────
const MOCK_RECENT = [
  { id: 'task-001', name: 'resnet50_v1', status: 'completed' as const, accuracy: '✓ 完美通过' },
  { id: 'task-002', name: 'yolov8_test', status: 'completed' as const, accuracy: '⚠ 精度超标' },
  { id: 'task-003', name: 'bert_base_eval', status: 'running' as const, progress: 45 },
]

export default function ToolPage() {
  const { toggleTheme } = useUIStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pageState, setPageState] = useState<PageState>('entry')
  const [dragOver, setDragOver] = useState(false)

  // Box state (State 1 sub-states)
  const [boxState, setBoxState] = useState<BoxState>('empty')
  const [model, setModel] = useState<ModelFile | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>(['tensorrt', 'openvino'])
  const [quantPrecision, setQuantPrecision] = useState('fp16')
  const [batchSize, setBatchSize] = useState('4')

  // Running state
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  // Analysis state (State 2)
  const [layers, setLayers] = useState<LayerDiff[]>([])
  const [layersLoading, setLayersLoading] = useState(false)
  const [selectedFramework, setSelectedFramework] = useState('tensorrt')
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)

  // ── Upload ───────────────────────────────────────
  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.onnx')) return
    setUploadProgress(0)
    try {
      const m = await uploadModel(file, (pct) => setUploadProgress(pct))
      setModel(m)
      setUploadProgress(100)
      setBoxState('config')
    } catch {
      console.error('upload failed')
    }
  }, [])

  const handleRemoveModel = () => {
    setModel(null)
    setBoxState('empty')
    setUploadProgress(0)
  }

  // ── Run ──────────────────────────────────────────
  const handleRun = async () => {
    if (!model || selectedFrameworks.length === 0) return
    setBoxState('running')
    setRunning(true)
    setLogs([])
    setTask(null)
    try {
      const t = await createTask({
        modelId: model.id,
        frameworks: ['onnxruntime', ...selectedFrameworks],
      })
      setTask(t)

      const poll = setInterval(async () => {
        const updated = await getTask(t.id)
        setTask(updated)
        setLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] ${selectedFrameworks.join('/')} executing layer ${updated.progress}%`,
        ])
        if (updated.status === 'completed') {
          clearInterval(poll)
          setRunning(false)
          setLayersLoading(true)
          const allLayers = await getTaskLayers(t.id)
          setLayers(allLayers)
          setLayersLoading(false)
          setPageState('analysis')
        }
        if (updated.status === 'failed') {
          clearInterval(poll)
          setRunning(false)
        }
      }, 1500)
    } catch {
      setRunning(false)
    }
  }

  // ── Navigation ───────────────────────────────────
  const handleNewTask = () => {
    setPageState('entry')
    setBoxState('empty')
    setModel(null)
    setTask(null)
    setLayers([])
    setSelectedLayer(null)
    setLogs([])
  }

  const handleViewRecent = (id: string) => {
    // In MVP, load mock data for any recent task
    setPageState('analysis')
    setSelectedFramework('tensorrt')
    setSelectedLayer(null)
  }

  // ── Analysis data ────────────────────────────────
  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null
  const currentMetrics: OverallMetrics | null = task?.comparisons.find(
    (c) => c.framework.value === selectedFramework
  )?.overallMetrics ?? null

  // ── Framework toggle ─────────────────────────────
  const toggleFramework = (fw: string) => {
    setSelectedFrameworks((prev) =>
      prev.includes(fw) ? prev.filter((v) => v !== fw) : [...prev, fw]
    )
  }

  const FW_OPTIONS = [
    { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
    { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
  ]

  // ════════════════════════════════════════════════════
  // RENDER: STATE 1 - Entry Workspace
  // ════════════════════════════════════════════════════
  if (pageState === 'entry') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* ── Top nav ── */}
        <div className="flex items-center justify-between h-12 px-6 border-b border-muted">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="#1677ff" />
              <path d="M16 6l8 12H8l8-12z" fill="white" />
              <circle cx="16" cy="22" r="3" fill="white" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">ModelDiff</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">文档</button>
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={toggleTheme}>☀</button>
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs text-muted-foreground">👤</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
          {/* ── Title ── */}
          <h1 className="text-xl font-semibold tracking-tight mb-6">神经网络模型精度比对</h1>

          {/* ── Core box ── */}
          <div className="w-full max-w-[640px]">
            {/* EMPTY STATE */}
            {boxState === 'empty' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleUpload(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-accent/30'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".onnx"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                />
                <div className="rounded-full bg-primary/10 w-12 h-12 flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground font-medium">点击或拖拽选择 .onnx 文件</p>
                <p className="text-xs text-muted-foreground/60 mt-1">放置文件在此处。最大支持 2 GB</p>
              </div>
            )}

            {/* CONFIG STATE */}
            {boxState === 'config' && model && (
              <div className="border rounded-xl p-6 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* File info */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileIcon className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{model.name}</p>
                      <p className="text-xs text-muted-foreground">{formatSize(model.size)}</p>
                    </div>
                    <Badge variant="success" className="text-[10px]">已上传</Badge>
                  </div>
                  <button onClick={handleRemoveModel} className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2">✕</button>
                </div>

                <div className="h-px bg-border" />

                {/* Config params */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">配置比对参数</p>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Frameworks */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">比对目标框架</label>
                      <div className="flex gap-2">
                        {FW_OPTIONS.map((fw) => (
                          <button
                            key={fw.value}
                            onClick={() => toggleFramework(fw.value)}
                            className={cn(
                              'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                              selectedFrameworks.includes(fw.value)
                                ? 'bg-accent border-border text-accent-foreground'
                                : 'border-border/50 text-muted-foreground hover:border-border'
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: fw.color }} />
                              {fw.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quant precision */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">目标量化精度</label>
                      <Select value={quantPrecision} onValueChange={setQuantPrecision}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fp32" className="text-xs">FP32（全精度）</SelectItem>
                          <SelectItem value="fp16" className="text-xs">FP16（半精度）</SelectItem>
                          <SelectItem value="int8" className="text-xs">INT8（熵校准）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Batch size */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">推理 Batch Size</label>
                      <Select value={batchSize} onValueChange={setBatchSize}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 4, 8, 16, 32].map((v) => (
                            <SelectItem key={v} value={String(v)} className="text-xs">{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Dataset (placeholder/disabled in MVP) */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">输入验证集</label>
                      <Select defaultValue="imagenet-500">
                        <SelectTrigger className="h-8 text-xs text-muted-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="imagenet-500" className="text-xs">ImageNet-Val (500样本)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Run button */}
                <Button
                  className="w-full h-10 text-sm gap-2"
                  disabled={selectedFrameworks.length === 0}
                  onClick={handleRun}
                >
                  <Layers className="h-4 w-4" />
                  开始分析（预计耗时 ~10 分钟）
                </Button>
              </div>
            )}

            {/* RUNNING STATE */}
            {boxState === 'running' && task && (
              <div className="border rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">正在分析: {model?.name}</p>
                    <p className="text-xs text-muted-foreground">进度: {task.progress}%  |  ETA: 估算中</p>
                  </div>
                </div>

                <Progress value={task.progress} className="h-2" />

                {/* Logs */}
                <div className="bg-black/40 rounded-md p-3 h-28 overflow-y-auto font-mono text-[11px] space-y-0.5">
                  {logs.map((log, i) => (
                    <div key={i} className="text-green-400/80">{log}</div>
                  ))}
                  {logs.length === 0 && <div className="text-muted-foreground/50">等待执行日志...</div>}
                </div>

                <p className="text-[11px] text-muted-foreground text-center">
                  完成后将自动进入分析视图
                </p>
              </div>
            )}
          </div>

          {/* ── Recent tasks ── */}
          <div className="w-full max-w-[640px] mt-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">最近分析任务</span>
              <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                查看全部 ➔
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {MOCK_RECENT.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleViewRecent(r.id)}
                  className="text-left border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate">{r.name}</span>
                  </div>
                  <div>
                    {r.status === 'completed' && (
                      <span className={cn(
                        'text-[11px]',
                        r.accuracy?.includes('完美') ? 'text-pass' : 'text-warn'
                      )}>
                        {r.accuracy}
                      </span>
                    )}
                    {r.status === 'running' && (
                      <div className="flex items-center gap-2">
                        <Progress value={r.progress} className="h-1 flex-1" />
                        <span className="text-[11px] text-muted-foreground font-mono">{r.progress}%</span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════
  // RENDER: STATE 2 - Immersive Analysis
  // ════════════════════════════════════════════════════
  return (
    <div className="h-screen bg-background flex flex-col">
      {/* ── Analysis top bar ── */}
      <div className="flex items-center justify-between h-12 px-6 border-b border-muted shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="#1677ff" />
              <path d="M16 6l8 12H8l8-12z" fill="white" />
              <circle cx="16" cy="22" r="3" fill="white" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">ModelDiff</span>
          </div>
          <div className="w-px h-4 bg-muted" />
          <span className="text-xs font-mono font-medium">task_{model?.name ?? 'unknown'}</span>
          <span className="text-xs text-muted-foreground font-mono">|</span>
          <span className="text-xs text-muted-foreground">{model?.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <Select value={selectedFramework} onValueChange={(v) => { setSelectedFramework(v); setSelectedLayer(null) }}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedFrameworks.map((fw) => {
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

          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleNewTask}>
            <Plus className="h-3.5 w-3.5" />
            建立新分析任务
          </Button>

          <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={toggleTheme}>☀</button>
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xs text-muted-foreground">👤</span>
          </div>
        </div>
      </div>

      {/* ── Analysis content ── */}
      <div className="flex-1 flex min-h-0">
        <div className={cn(
          'flex-1 min-w-0 overflow-y-auto p-5 space-y-4',
          selectedLayerData && 'pr-0'
        )}>
          {/* Metrics */}
          <SummaryBar metrics={currentMetrics} loading={false} />

          {/* Charts */}
          {task?.comparisons && task.comparisons.length > 0 && (
            <OverviewChart comparisons={task.comparisons} />
          )}

          {/* Table */}
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
              <button
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setSelectedLayer(null)}
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Shape info */}
              <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded-md p-2.5">
                输入 [{selectedLayerData.inputShape.join(', ')}] → 输出 [{selectedLayerData.outputShape.join(', ')}]
              </div>

              {/* Per-framework metrics */}
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
                          <div
                            key={item.key}
                            className={cn(
                              'p-2 rounded-md border text-xs',
                              passed ? 'border-pass/20 bg-pass/5' : 'border-fail/20 bg-fail/5'
                            )}
                          >
                            <div className="text-muted-foreground text-[10px] mb-0.5">{item.label}</div>
                            <span
                              className="font-mono text-sm font-bold tabular-nums"
                              style={{ color: passed ? '#22c55e' : '#ef4444' }}
                            >
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
    </div>
  )
}
