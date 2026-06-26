import type { ModelFile } from './model'
import type { FrameworkResult } from './framework'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ComparisonTask {
  id: string
  model: ModelFile
  frameworks: string[]
  status: TaskStatus
  progress: number
  createdAt: string
  completedAt?: string
  error?: string
  baseline: FrameworkResult | null
  comparisons: FrameworkResult[]
}

export interface CreateTaskParams {
  modelId: string
  frameworks: string[]
}
