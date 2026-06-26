import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { getModule } from '../tasks/registry.js'
import { executeTask, cancelTask } from '../lib/task-engine.js'

const router = Router()

// 创建任务
router.post('/', async (req: Request, res: Response) => {
  try {
    const { module, fileIds, params } = req.body
    if (!module) return res.status(400).json({ error: 'module required' })
    if (!getModule(module)) return res.status(400).json({ error: `unknown module: ${module}` })

    // @ts-ignore
    const userId = req.user?.id ?? 1

    const task = await prisma.task.create({
      data: {
        userId,
        module,
        status: 'pending',
        params: JSON.stringify(params ?? {}),
        fileIds: JSON.stringify(fileIds ?? []),
      },
    })

    // 异步执行
    executeTask(task.id).catch(console.error)

    res.json({
      id: task.id,
      module: task.module,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt.toISOString(),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 任务列表
router.get('/', async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.id ?? 1
    const module = req.query.module as string | undefined
    const status = req.query.status as string | undefined
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20

    const where: any = { userId }
    if (module) where.module = module
    if (status) where.status = status

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.task.count({ where }),
    ])

    res.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        module: t.module,
        status: t.status,
        progress: t.progress,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 任务详情
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'not found' })

    const resp: any = {
      id: task.id,
      module: task.module,
      status: task.status,
      progress: task.progress,
      params: JSON.parse(task.params),
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    }

    if (task.result) resp.result = JSON.parse(task.result)
    if (task.error) resp.error = task.error

    res.json(resp)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 取消任务
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'not found' })
    if (task.status !== 'running' && task.status !== 'pending') {
      return res.status(400).json({ error: `cannot cancel task in status: ${task.status}` })
    }

    cancelTask(task.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'cancelled', completedAt: new Date() },
    })

    res.json({ id: task.id, status: 'cancelled' })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 重试任务
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'not found' })
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return res.status(400).json({ error: `cannot retry task in status: ${task.status}` })
    }

    const newTask = await prisma.task.create({
      data: {
        userId: task.userId,
        module: task.module,
        status: 'pending',
        params: task.params,
        fileIds: task.fileIds,
      },
    })

    executeTask(newTask.id).catch(console.error)

    res.json({
      id: newTask.id,
      module: newTask.module,
      status: newTask.status,
      createdAt: newTask.createdAt.toISOString(),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
