import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'

const router = Router()

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ error: 'email already registered' })

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, password: hashed, name: name || null },
    })

    const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    })

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'invalid credentials' })

    const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    })

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/me', async (req: Request, res: Response) => {
  // @ts-ignore — passport 注入
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return res.status(404).json({ error: 'not found' })

  res.json({ id: user.id, email: user.email, name: user.name })
})

export default router
