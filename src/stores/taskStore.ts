import { create } from 'zustand'
import type { ComparisonTask, LayerDiff, TaskStatus } from '@/types'
import { createTask as apiCreateTask, getTask, getTaskLayers } from '@/api'

interface TaskState {
  currentTaskId: string | null
  task: ComparisonTask | null
  status: TaskStatus
  progress: number
  layers: LayerDiff[]
  selectedLayer: string | null
  selectedFramework: string

  createTask: (modelId: string, frameworks: string[]) => Promise<string>
  pollTask: (taskId: string) => Promise<void>
  loadLayers: (taskId: string, framework?: string) => Promise<void>
  setSelectedLayer: (layerName: string | null) => void
  setSelectedFramework: (framework: string) => void
  reset: () => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  currentTaskId: null,
  task: null,
  status: 'pending',
  progress: 0,
  layers: [],
  selectedLayer: null,
  selectedFramework: 'tensorrt',

  createTask: async (modelId, frameworks) => {
    const task = await apiCreateTask({ modelId, frameworks })
    set({ currentTaskId: task.id, task, status: task.status, progress: task.progress })
    return task.id
  },

  pollTask: async (taskId) => {
    const task = await getTask(taskId)
    set({ task, status: task.status, progress: task.progress })
    if (task.status === 'completed' || task.status === 'failed') {
      return
    }
    // Auto-poll every 2s while running
    setTimeout(() => get().pollTask(taskId), 2000)
  },

  loadLayers: async (taskId, framework) => {
    const fw = framework || get().selectedFramework
    const layers = await getTaskLayers(taskId, fw)
    set({ layers })
  },

  setSelectedLayer: (layerName) => set({ selectedLayer: layerName }),
  setSelectedFramework: (framework) => set({ selectedFramework: framework }),
  reset: () => set({
    currentTaskId: null,
    task: null,
    status: 'pending',
    progress: 0,
    layers: [],
    selectedLayer: null,
    selectedFramework: 'tensorrt',
  }),
}))
