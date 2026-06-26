import { useState, useCallback } from 'react'
import { Upload, FileIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { ModelFile, UploadProgress } from '@/types'
import { uploadModel } from '@/api/model'
import { cn } from '@/lib/utils'

interface Props {
  onUploaded: (model: ModelFile) => void
}

export function ModelUpload({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.onnx')) return
    setUploading(true)
    setProgress({ percent: 0, fileName: file.name, status: 'uploading' })
    try {
      const model = await uploadModel(file, (pct) => {
        setProgress({ percent: pct, fileName: file.name, status: 'uploading' })
      })
      setProgress({ percent: 100, fileName: file.name, status: 'done' })
      onUploaded(model)
    } catch {
      setProgress({ percent: 0, fileName: file.name, status: 'error' })
    } finally {
      setUploading(false)
    }
  }, [onUploaded])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center gap-3 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-all',
          dragOver
            ? 'border-primary bg-primary/10'
            : 'border-muted hover:border-muted-foreground/40 hover:bg-accent/50'
        )}
      >
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <div className="text-center space-y-0.5">
          <p className="text-sm font-medium text-muted-foreground">
            拖拽 ONNX 模型到此处，或<span className="text-primary hover:underline">点击选择</span>
          </p>
          <p className="text-xs text-muted-foreground/60">支持 .onnx 格式</p>
        </div>
        <input type="file" accept=".onnx" onChange={handleFileSelect} className="hidden" disabled={uploading} />
      </label>

      {progress && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-muted-foreground">{progress.fileName}</span>
            </div>
            <span className={cn(
              'shrink-0 ml-2',
              progress.status === 'done' && 'text-pass',
              progress.status === 'error' && 'text-fail'
            )}>
              {progress.status === 'done' ? '上传完成' :
               progress.status === 'error' ? '上传失败' : '上传中...'}
            </span>
          </div>
          <Progress
            value={progress.percent}
            className={cn('h-1', progress.status === 'done' && '[&>div]:bg-pass')}
          />
        </div>
      )}
    </div>
  )
}
