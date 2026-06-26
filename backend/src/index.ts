import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'

// 导入 passport 策略（注册 JWT 策略）
import './middleware/passport.js'

// 导入路由
import authRouter from './routers/auth.js'
import filesRouter from './routers/files.js'
import tasksRouter from './routers/tasks.js'

// 导入模型触发注册
import './tasks/model_diff/runner.js'
import { MODULES, getModule } from './tasks/registry.js'
import modelDiffRouter from './tasks/model_diff/router.js'

const app = express()

app.use(cors())
app.use(express.json())

// 请求日志
app.use((req, _res, next) => {
  const start = Date.now()
  _res.on('finish', () => {
    console.log(`  ${req.method} ${req.originalUrl} → ${_res.statusCode} (${Date.now() - start}ms)`)
  })
  next()
})

// ── 公开路由（无需认证） ──
app.use('/auth', authRouter)

// ── 需要认证的路由 ──
import { optionalAuth } from './middleware/auth.js'
app.use('/api/files', optionalAuth, filesRouter)
app.use('/api/tasks', optionalAuth, tasksRouter)
app.use('/api', optionalAuth, modelDiffRouter)

// ── 模块列表 ──
app.get('/api/modules', optionalAuth, (_req, res) => {
  res.json(
    Object.entries(MODULES).map(([key, mod]) => ({ key, name: mod.name }))
  )
})

// ── 启动 ──
async function main() {
  await prisma.$connect()
  console.log(`  已连接数据库`)
  console.log(`  已注册模块: ${Object.keys(MODULES).join(', ')}`)

  app.listen(config.port, () => {
    console.log(`  Taskit API → http://localhost:${config.port}`)
  })
}

main().catch(console.error)
