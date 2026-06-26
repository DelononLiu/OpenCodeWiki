import type { ComponentType } from 'react'

export interface ModuleDef {
  name: string
  icon: string
  TaskForm: ComponentType<{ onTaskCreated: (taskId: string) => void }>
  ResultViewer: ComponentType<{ taskId: string; onNewTask: () => void }>
}

export const MODULES: Record<string, ModuleDef> = {
  // 注册在 model_diff/index.ts 中
}

export function getModule(name: string): ModuleDef | undefined {
  return MODULES[name]
}
