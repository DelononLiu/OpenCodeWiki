import { spawn } from 'child_process'
import { prisma } from './prisma.js'
import { getModule } from '../tasks/registry.js'

// 管理运行中的子进程，用于取消
const runningProcesses = new Map<string, ReturnType<typeof spawn>>()

export function cancelTask(taskId: string): boolean {
  const proc = runningProcesses.get(taskId)
  if (!proc) return false
  proc.kill('SIGTERM')
  setTimeout(() => {
    try { proc.kill('SIGKILL') } catch {}
  }, 5000)
  return true
}

export async function executeTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task || task.status === 'cancelled') return

  await prisma.task.update({ where: { id: taskId }, data: { status: 'running' } })

  try {
    const params = JSON.parse(task.params)
    const fileIds: string[] = JSON.parse(task.fileIds)

    let inputPath = ''
    if (fileIds.length > 0) {
      const file = await prisma.file.findUnique({ where: { id: fileIds[0] } })
      if (file) inputPath = file.storedPath
    }

    const mod = getModule(task.module)
    if (!mod) throw new Error(`Unknown module: ${task.module}`)

    const cmd = mod.shell
      .replace('{input_path}', inputPath)
      .replace('{params}', JSON.stringify(params))
      .replace('{task_id}', taskId)

    const child = spawn('bash', ['-c', cmd], {
      timeout: 3600_000,
    })
    runningProcesses.set(taskId, child)

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => { stdout += data.toString() })
    child.stderr?.on('data', (data) => { stderr += data.toString() })

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', resolve)
      child.on('error', () => resolve(1))
    })

    runningProcesses.delete(taskId)

    // 检查是否被取消
    const current = await prisma.task.findUnique({ where: { id: taskId } })
    if (current?.status === 'cancelled') return

    if (exitCode !== 0) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'failed', error: stderr.slice(0, 2000) || `Exit code: ${exitCode}` },
      })
      return
    }

    const output = JSON.parse(stdout)
    const parsed = mod.parser?.(output, params) ?? output

    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'completed', progress: 100, result: JSON.stringify(parsed), completedAt: new Date() },
    })
  } catch (e: any) {
    runningProcesses.delete(taskId)
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: e.message?.slice(0, 2000) },
    })
  }
}
