import { api } from './client'
import { mockApi } from './mock/handlers'
import type { CreateTaskParams, ComparisonTask, LayerDiff } from '@/types'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

function getToken() {
  return localStorage.getItem('token') || ''
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` }
}

export async function createTask(params: CreateTaskParams): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.createTask(params)
  }

  const body = {
    module: 'model_diff',
    fileIds: params.modelId ? [params.modelId] : [],
    params: { frameworks: params.frameworks.filter(f => f !== 'onnxruntime') },
  }

  const resp: any = await api.post('/tasks', body, { headers: authHeaders() })
  return {
    id: resp.id,
    model: { id: '', name: '', format: 'onnx', size: 0, uploadTime: '' },
    frameworks: params.frameworks,
    status: resp.status,
    progress: resp.progress,
    createdAt: resp.createdAt,
    baseline: null,
    comparisons: [],
  }
}

export async function getTask(taskId: string): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.getTask(taskId)
  }

  const resp: any = await api.get(`/tasks/${taskId}`, { headers: authHeaders() })
  const result = resp.result || {}

  return {
    id: resp.id,
    model: { id: '', name: '', format: 'onnx', size: 0, uploadTime: '' },
    frameworks: resp.params?.frameworks || [],
    status: resp.status,
    progress: resp.progress,
    createdAt: resp.createdAt,
    completedAt: resp.completedAt,
    error: resp.error,
    baseline: null,
    comparisons: result.overall ? [
      { framework: { id: 'tensorrt', name: 'TensorRT', value: 'tensorrt' }, overallMetrics: result.overall },
    ] : [],
  }
}

export async function getTaskLayers(taskId: string, framework?: string): Promise<LayerDiff[]> {
  if (USE_MOCK) {
    return mockApi.getTaskLayers(taskId, framework)
  }

  const qs = framework ? `?framework=${framework}` : ''
  const resp: any = await api.get(`/modules/model_diff/tasks/${taskId}/layers${qs}`, {
    headers: authHeaders(),
  })
  return resp.layers || []
}

export async function getTaskHistory(page = 1, limit = 20): Promise<any[]> {
  if (USE_MOCK) {
    return []
  }

  const resp: any = await api.get(`/tasks?page=${page}&limit=${limit}`, {
    headers: authHeaders(),
  })

  return (resp.tasks || []).map((t: any) => ({
    id: t.id,
    name: `任务 ${t.id.slice(0, 8)}`,
    model: t.module || '',
    date: t.createdAt?.slice(0, 16).replace('T', ' ') || '',
    status: t.status,
    accuracy: t.status === 'completed' ? '✓ 完成' : t.status === 'failed' ? '✗ 失败' : undefined,
    progress: t.progress,
  }))
}

export async function cancelTask(taskId: string): Promise<any> {
  if (USE_MOCK) return { id: taskId, status: 'cancelled' }
  return api.post(`/tasks/${taskId}/cancel`, undefined, { headers: authHeaders() })
}

export async function retryTask(taskId: string): Promise<any> {
  if (USE_MOCK) return { id: `retry-${taskId}`, status: 'pending' }
  return api.post(`/tasks/${taskId}/retry`, undefined, { headers: authHeaders() })
}
