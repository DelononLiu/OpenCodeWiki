import { Router, Request, Response } from 'express'
import { prisma } from '../../lib/prisma.js'

const router = Router()

router.get('/modules/model_diff/tasks/:id/layers', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const framework = req.query.framework as string | undefined

    const task = await prisma.task.findUnique({ where: { id } })
    if (!task || !task.result) return res.json({ layers: [] })

    const data = JSON.parse(task.result)
    let layers = data.layers ?? []

    if (framework) {
      layers = layers.map((layer: any) => ({
        ...layer,
        metrics: (layer.metrics ?? []).filter((m: any) => m.frameworkId === framework),
      })).filter((layer: any) => layer.metrics.length > 0)
    }

    res.json({ layers })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
