import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(config.uploadDir, { recursive: true })
    cb(null, config.uploadDir)
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${unique}-${file.originalname}`)
  },
})

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }) // 2GB

const router = Router()

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no file' })

    // @ts-ignore
    const userId = req.user?.id ?? 1

    const record = await prisma.file.create({
      data: {
        userId,
        filename: file.originalname,
        storedPath: file.path,
        size: file.size,
        mimeType: file.mimetype,
      },
    })

    res.json({
      id: record.id,
      name: record.filename,
      format: 'onnx',
      size: record.size,
      uploadTime: record.createdAt.toISOString(),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  const file = await prisma.file.findUnique({ where: { id: req.params.id } })
  if (!file) return res.status(404).json({ error: 'not found' })
  res.json({
    id: file.id,
    name: file.filename,
    size: file.size,
    uploadTime: file.createdAt.toISOString(),
  })
})

export default router
