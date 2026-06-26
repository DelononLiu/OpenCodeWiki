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
    <div className="max-w-xl mx-auto mt-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">模型精度差异分析</h1>
        <p className="text-sm text-muted-foreground">
          上传 ONNX 模型，以 ONNX Runtime 为基准，比对其他推理框架的精度差异
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <ModelUpload onUploaded={setModel} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
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
