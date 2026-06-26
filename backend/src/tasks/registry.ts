export interface ModuleDef {
  name: string
  shell: string
  parser: (stdout: any, params: any) => any
}

export const MODULES: Record<string, ModuleDef> = {}

export function getModule(name: string): ModuleDef | undefined {
  return MODULES[name]
}
