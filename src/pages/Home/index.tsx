import { useState } from 'react'
import { Card, Space } from 'antd'
import { useNavigate } from 'react-router-dom'
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
      // Include baseline (onnxruntime) always
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
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 600, margin: '40px auto', display: 'flex' }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>模型精度差异分析</h2>
        <p style={{ color: '#666', marginTop: 8 }}>
          上传 ONNX 模型，以 ONNX Runtime 为基准，比对其他推理框架的精度差异
        </p>
      </div>

      <Card>
        <ModelUpload onUploaded={setModel} />
      </Card>

      <Card>
        <FrameworkSelector selected={frameworks} onChange={setFrameworks} />
      </Card>

      <TaskStarter
        modelUploaded={model !== null}
        hasFrameworks={frameworks.length > 0}
        disabled={!canStart}
        loading={loading}
        onClick={handleStart}
      />
    </Space>
  )
}
