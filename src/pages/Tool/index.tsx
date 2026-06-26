import { useState, useRef, useCallback } from 'react'
import { Upload, Play, FileIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { getFrameworkColor } from '@/utils/color'
import { uploadModel } from '@/api/model'
import { createTask, getTask, getTaskLayers } from '@/api/task'
import { useUIStore } from '@/stores/uiStore'
import { SummaryBar } from '@/pages/TaskDetail/SummaryBar'
import { OverviewChart } from '@/pages/TaskDetail/OverviewChart'
import { LayerTable } from '@/pages/TaskDetail/LayerTable'
import { LayerDetail } from '@/pages/TaskDetail/LayerDetail'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ModelFile, ComparisonTask, LayerDiff, OverallMetrics } from '@/types'

const FW_OPTIONS = [
  { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
]

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export default function ToolPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme, toggleTheme } = useUIStore()

  // State
  const [model, setModel] = useState<ModelFile | null>(null)
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>(['tensorrt'])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [running, setRunning] = useState(false)
  const [layers, setLayers] = useState<LayerDiff[]>([])
  const [layersLoading, setLayersLoading] = useState(false)
  const [selectedFramework, setSelectedFramework] = useState('tensorrt')
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)

  // Upload
  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.onnx')) return
    setUploading(true)
    setUploadProgress(0)
    try {
      const m = await uploadModel(file, (pct) => setUploadProgress(pct))
      setModel(m)
      setUploadProgress(100)
      setTask(null)
      setLayers([])
      setSelectedLayer(null)
    } catch {
      console.error('upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  // Run
  const handleRun = async () => {
    if (!model || selectedFrameworks.length === 0) return
    setRunning(true)
    setTask(null)
    setLayers([])
    setSelectedLayer(null)
    try {
      const t = await createTask({
        modelId: model.id,
        frameworks: ['onnxruntime', ...selectedFrameworks],
      })
      setTask(t)

      // Poll
      const poll = setInterval(async () => {
        const updated = await getTask(t.id)
        setTask(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(poll)
          setRunning(false)
          setLayersLoading(true)
          const allLayers = await getTaskLayers(t.id)
          setLayers(allLayers)
          setLayersLoading(false)
        }
      }, 1500)
    } catch {
      setRunning(false)
    }
  }

  // Layer selection
  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null
  const currentMetrics: OverallMetrics | null = task?.comparisons.find(
    (c) => c.framework.value === selectedFramework
  )?.overallMetrics ?? null

  // Framework toggle
  const toggleFramework = (fw: string) => {
    setSelectedFrameworks((prev) =>
      prev.includes(fw) ? prev.filter((v) => v !== fw) : [...prev, fw]
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 h-12 px-4 border-b border-muted shrink-0 bg-card">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-1">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none" className="shrink-0">
            <rect width="32" height="32" rx="6" fill="#1677ff" />
            <path d="M16 6l8 12H8l8-12z" fill="white" />
            <circle cx="16" cy="22" r="3" fill="white" />
          </svg>
          <span className="text-xs font-semibold tracking-tight">ModelDiff</span>
        </div>

        <div className="w-px h-5 bg-muted" />

        {/* Upload */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          选择模型
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".onnx"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />

        {/* Model info */}
        {model && (
          <>
            <div className="w-px h-5 bg-muted" />
            <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-foreground">{model.name}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{formatSize(model.size)}</span>
            <Badge variant="success" className="text-[10px] h-4 px-1.5">已上传</Badge>
          </>
        )}

        {uploading && (
          <Progress value={uploadProgress} className="h-1 w-20" />
        )}

        <div className="w-px h-5 bg-muted" />

        {/* Framework picker (inline) */}
        <div className="flex items-center gap-1">
          {FW_OPTIONS.map((fw) => (
            <button
              key={fw.value}
              onClick={() => toggleFramework(fw.value)}
              className={cn(
                'px-2 py-1 rounded text-[11px] font-medium transition-colors border',
                selectedFrameworks.includes(fw.value)
                  ? 'bg-accent text-accent-foreground border-border'
                  : 'text-muted-foreground border-transparent hover:border-border'
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: fw.color }} />
                {fw.label}
              </span>
            </button>
          ))}
        </div>

        {/* Run */}
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          disabled={!model || selectedFrameworks.length === 0 || running}
          onClick={handleRun}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          运行
        </Button>

        <div className="flex-1" />

        {/* Model info bar */}
        {task && task.status === 'completed' && (
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <Select value={selectedFramework} onValueChange={(v) => { setSelectedFramework(v); setSelectedLayer(null) }}>
              <SelectTrigger className="h-6 w-24 text-[11px] bg-transparent border-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectedFrameworks.map((fw) => {
                  const cfg = FW_OPTIONS.find((o) => o.value === fw)
                  return (
                    <SelectItem key={fw} value={fw} className="text-[11px]">
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
        )}

        {task && task.status === 'running' && (
          <span className="text-[11px] text-primary flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            推理中 {task.progress}%
          </span>
        )}

        {/* Theme */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleTheme}>
          <span className="text-xs">{theme === 'dark' ? '☀' : '☾'}</span>
        </Button>
      </div>

      {/* ── Main area ─────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: content */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Empty state */}
          {!task && !running && (
            <div className="p-6 flex justify-center">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleUpload(file)
                }}
                className={cn(
                  'inline-flex items-center gap-5 px-6 py-4 rounded-lg border-2 border-dashed transition-colors cursor-pointer',
                  dragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/20 hover:border-muted-foreground/40'
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground/50 shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {model ? '模型已上传，选择框架后点击运行' : '拖拽 ONNX 模型到此处，或点击工具栏上传'}
                  </p>
                  {model && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      {model.name} · {formatSize(model.size)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Running state */}
          {running && !task?.comparisons.length && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">正在运行推理...</p>
              {task && <Progress value={task.progress} className="h-1 w-48" />}
            </div>
          )}

          {/* Results */}
          {task && task.status === 'completed' && task.comparisons.length > 0 && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <SummaryBar metrics={currentMetrics} loading={false} />
              <OverviewChart comparisons={task.comparisons} />
              <div>
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  层精度对比
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
          )}
        </div>

        {/* Right: detail panel */}
        {selectedLayerData && (
          <div className="w-[380px] shrink-0 border-l border-muted overflow-y-auto">
            <LayerDetail
              layer={selectedLayerData}
              onClose={() => setSelectedLayer(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
