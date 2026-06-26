import { MODULES } from '@/tasks/registry'
import { ModelDiffForm } from './TaskForm'
import { ModelDiffResult } from './ResultViewer'

MODULES.model_diff = {
  name: '模型精度比对',
  icon: 'Layers',
  TaskForm: ModelDiffForm,
  ResultViewer: ModelDiffResult,
}
