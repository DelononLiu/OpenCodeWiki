import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { ModelUpload } from './ModelUpload'
import { FrameworkSelector } from './FrameworkSelector'
import { TaskStarter } from './TaskStarter'
import { createTask } from '@/api/task'
import type { ModelFile } from '@/types'

export default function HomePage() {
  const navigate = useNavigate()
  const [model, setModel] = useState<ModelFile | null>(null)
  const [frameworks, setFrameworks] = useState<string[]>(['tensorrt'])
  const [loading, setLoading] = useState(false)

  const handleStart = async () => {
    if (!model) return
    setLoading(true)
    try {
      const allFrameworks = ['onnxruntime', ...frameworks]
      const task = await createTask({ modelId: model.id, frameworks: allFrameworks })
      navigate(`/task/${task.id}`)
    } catch (err) {
      console.error('Failed to create task', err)
    } finally {
      setLoading(false)
    }
  }

  const canStart = model !== null && frameworks.length > 0

  return (
    <div className="max-w-lg mx-auto mt-10 space-y-4">
      <div className="text-center space-y-1 mb-6">
        <h1 className="text-lg font-semibold tracking-tight">模型精度差异分析</h1>
        <p className="text-xs text-muted-foreground">
          上传 ONNX 模型，以 ONNX Runtime 为基准，比对推理框架的精度差异
        </p>
      </div>

      <Card className="border-muted">
        <CardContent className="p-4">
          <ModelUpload onUploaded={setModel} />
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="p-4">
          <FrameworkSelector selected={frameworks} onChange={setFrameworks} />
        </CardContent>
      </Card>

      <TaskStarter
        modelUploaded={model !== null}
        hasFrameworks={frameworks.length > 0}
        disabled={!canStart}
        loading={loading}
        onClick={handleStart}
      />
    </div>
  )
}
