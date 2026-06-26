import { useState, useCallback } from 'react'
import { Upload, X, FileIcon } from 'lucide-react'
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
          'flex flex-col items-center gap-3 p-10 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
          uploading && 'pointer-events-none opacity-60'
        )}
      >
        <div className="rounded-full bg-primary/10 p-3">
          <Upload className="h-6 w-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">拖拽 ONNX 模型到此处，或点击选择</p>
          <p className="text-xs text-muted-foreground mt-1">支持 .onnx 格式</p>
        </div>
        <input
          type="file"
          accept=".onnx"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
      </label>

      {progress && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{progress.fileName}</span>
            </div>
            <span className={cn(
              'text-xs shrink-0 ml-2',
              progress.status === 'done' && 'text-green-600',
              progress.status === 'error' && 'text-red-500'
            )}>
              {progress.status === 'done' ? '✅ 上传完成' :
               progress.status === 'error' ? '上传失败' : '上传中...'}
            </span>
          </div>
          <Progress
            value={progress.percent}
            className={cn(progress.status === 'done' && '[&>div]:bg-green-500')}
          />
        </div>
      )}
    </div>
  )
}
