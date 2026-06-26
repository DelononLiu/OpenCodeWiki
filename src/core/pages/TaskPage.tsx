import { useParams, useNavigate } from 'react-router-dom'
import { getModule } from '@/tasks/registry'
import '@/tasks/model_diff' // ensure registered
import { MODULES } from '@/tasks/registry'

export default function TaskPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // For now, always render model_diff result view
  const mod = getModule('model_diff')

  if (!mod || !id) {
    return <div className="p-6 text-sm text-muted-foreground">任务不存在</div>
  }

  return (
    <mod.ResultViewer
      taskId={id}
      onNewTask={() => navigate('/')}
    />
  )
}
