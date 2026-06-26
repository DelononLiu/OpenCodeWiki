import type { CreateTaskParams, ComparisonTask, LayerDiff } from '@/types'
import { mockApi } from './mock/handlers'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export async function createTask(params: CreateTaskParams): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.createTask(params)
  }
  throw new Error('Real API not implemented')
}

export async function getTask(taskId: string): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.getTask(taskId)
  }
  throw new Error('Real API not implemented')
}

export async function getTaskLayers(taskId: string, framework?: string): Promise<LayerDiff[]> {
  if (USE_MOCK) {
    return mockApi.getTaskLayers(taskId, framework)
  }
  throw new Error('Real API not implemented')
}
