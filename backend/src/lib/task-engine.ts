import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from './prisma.js'
import { getModule } from '../modules/registry.js'

const execAsync = promisify(exec)

export async function executeTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return

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

    const { stdout } = await execAsync(cmd, { timeout: 3600_000, maxBuffer: 100 * 1024 * 1024 })
    const output = JSON.parse(stdout)
    const parsed = mod.parser?.(output, params) ?? output

    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'completed', progress: 100, result: JSON.stringify(parsed), completedAt: new Date() },
    })
  } catch (e: any) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: e.message?.slice(0, 2000) },
    })
  }
}
