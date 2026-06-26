import { useNavigate } from 'react-router-dom'
import { MODULES } from '@/tasks/registry'
import '@/tasks/model_diff' // trigger registration

export default function HomePage() {
  const navigate = useNavigate()
  const entries = Object.entries(MODULES)

  const firstKey = entries[0]?.[0]
  const FirstModule = firstKey ? MODULES[firstKey] : null

  return (
    <>
      {FirstModule && (
        <FirstModule.TaskForm
          onTaskCreated={(tid) => navigate(`/tasks/${tid}`)}
        />
      )}
    </>
  )
}
