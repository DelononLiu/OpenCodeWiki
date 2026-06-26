# Taskit 架构设计

## 定位

```
上传文件 → 创建 Task → 后台执行 → 查看结果
```

Task 是唯一的核心抽象。平台管理任务生命周期，不关心任务内容。
模型精度比对是第一个任务类型，后续可扩展日志分析等。

后端是薄 API 层，核心计算在独立 shell 脚本中，与后端语言无关。

---

## 技术栈

| 层 | 选型 |
|---|---|
| Web 框架 | **Express**（TypeScript） |
| ORM | **Prisma** |
| 数据库 | **SQLite**（开发）→ 可升 PostgreSQL |
| 认证 | **Passport.js + JWT** |
| 文件上传 | **multer** |
| 任务执行 | **child_process.exec()** 调 shell 脚本，语言无关 |
| 运行 | **tsx + node** |

---

## 整体架构

```
┌──────────────────────────────────────────────────┐
│                     Taskit                        │
│                                                   │
│  Frontend (Vite :5173)      Backend (Express :8000)│
│  ┌──────────────────┐      ┌──────────────────┐   │
│  │ core/             │      │ src/             │   │
│  │  ├─ Auth          │      │  ├─ auth         │   │
│  │  ├─ FileUpload    │      │  ├─ files        │   │
│  │  ├─ TaskList      │      │  ├─ tasks        │   │
│  │  ├─ TaskDetail    │      │  ├─ task-engine  │   │
│  │  └─ moduleRouter  │      │  └─ prisma       │   │
│  ├──────────────────┤      ├──────────────────┤   │
│  │ modules/          │      │ modules/          │   │
│  │  ├─ model_diff/   │◄────►│  ├─ model_diff/   │   │
│  │  │  Form + Viewer │      │  │  runner+router │   │
│  │  ├─ ...           │      │  ├─ ...           │   │
│  └──────────────────┘      └──────────────────┘   │
│                                                   │
│  类型共享: src/types/*.ts ← frontend + backend 共用 │
└──────────────────────────────────────────────────┘
```

---

## 数据库核心：Task

Prisma schema：

```prisma
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  password     String   // bcrypt hashed
  name         String?
  createdAt    DateTime @default(now())
  tasks        Task[]
  files        File[]
}

model File {
  id         String   @id @default(uuid())
  userId     Int
  filename   String
  storedPath String
  size       Int
  mimeType   String   @default("application/octet-stream")
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
}

model Task {
  id          String    @id @default(uuid())
  userId      Int
  module      String    // "model_diff" | "log_analyzer"
  status      String    @default("pending")  // pending → running → completed / failed
  progress    Int       @default(0)
  params      String    @default("{}")       // JSON
  result      String?                        // JSON
  error       String?
  fileIds     String    @default("[]")       // JSON array
  createdAt   DateTime  @default(now())
  completedAt DateTime?
  user        User      @relation(fields: [userId], references: [id])
}
```

**一个表管所有任务类型**。`params` 和 `result` 是 JSON，模块自己定义格式。

---

## 后端目录结构

```
backend/
├── package.json
├── tsconfig.json
├── .env
│
├── prisma/
│   └── schema.prisma
│
└── src/
    ├── index.ts                  # Express 入口
    ├── config.ts                 # 配置（JWT 密钥、上传路径等）
    │
    ├── lib/
    │   ├── prisma.ts             # Prisma 客户端单例
    │   └── task-engine.ts        # child_process 执行器
    │
    ├── middleware/
    │   ├── auth.ts               # JWT 验证中间件
    │   └── passport.ts           # Passport.js 策略
    │
    ├── routers/
    │   ├── auth.ts               # POST /auth/register, /auth/login
    │   ├── files.ts              # POST /api/files/upload, GET /api/files/:id
    │   └── tasks.ts              # POST /api/tasks, GET /api/tasks, GET /api/tasks/:id
    │
    └── modules/
        ├── registry.ts           # 模块注册表
        └── model_diff/
            ├── runner.ts         # shell 命令模板 + stdout 解析
            └── router.ts         # GET /api/modules/model_diff/tasks/:id/layers
```

---

## 模块注册

```typescript
// src/modules/registry.ts
export interface ModuleDef {
  name: string
  shell: string      // shell 命令模板
  parser: (stdout: object, params: object) => object
}

export const MODULES: Record<string, ModuleDef> = {
  model_diff: {
    name: '模型精度比对',
    shell: 'bash /opt/runners/model_diff/run.sh --input {input_path} --params \'{params}\'',
    parser: (stdout, params) => ({
      overall: stdout.overall,
      layers: stdout.layers,
    }),
  },
}

export function getModule(name: string) {
  return MODULES[name]
}
```

---

## API 路由

### 通用路由（core 提供，所有模块共享）
```
POST   /auth/register         注册 { email, password, name? }
POST   /auth/login            登录 → JWT
GET    /auth/me               当前用户（需 JWT）

POST   /api/files/upload      上传文件（multipart）
GET    /api/files/:id         文件信息

POST   /api/tasks             创建任务 { module, fileIds?, params }
GET    /api/tasks              任务列表（分页，可筛 module/status）
GET    /api/tasks/:id          任务详情（含 result）

GET    /api/modules            已注册模块列表
```

### 模块路由（按需）
```
GET    /api/modules/model_diff/tasks/:id/layers?framework=xxx
```

---

## 任务执行

```typescript
// src/lib/task-engine.ts
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function executeTask(taskId: string, shellTemplate: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return

  await prisma.task.update({ where: { id: taskId }, data: { status: 'running' } })

  try {
    const params = JSON.parse(task.params)
    const fileIds = JSON.parse(task.fileIds)
    // 查文件路径
    const file = fileIds[0] ? await prisma.file.findUnique({ where: { id: fileIds[0] } }) : null

    const cmd = shellTemplate
      .replace('{input_path}', file?.storedPath ?? '')
      .replace('{params}', JSON.stringify(params))
      .replace('{task_id}', taskId)

    const { stdout } = await execAsync(cmd, { timeout: 3600_000 })
    const output = JSON.parse(stdout)

    const mod = getModule(task.module)
    const parsed = mod?.parser?.(output, params) ?? output

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
```

---

## 扩展方式

新建一个任务类型只需：

| 步骤 | 后端 | 前端 |
|------|------|------|
| 1 | 写 shell 脚本（任意语言） | — |
| 2 | `registry.ts` 加 1 条 | `registry.ts` 加 1 条 |
| 3 | — | 写 TaskForm.tsx + ResultViewer.tsx |

**core 不动**。

---

## 阶段计划

### Phase 1 — 后端骨架（本次）
- [ ] backend/ 初始化（package.json, tsconfig, prisma）
- [ ] Prisma schema（User, File, Task）
- [ ] JWT 认证（register / login）
- [ ] 文件上传路由
- [ ] Task CRUD 路由
- [ ] task-engine（subprocess 执行器）
- [ ] model_diff 模块注册 + layers 路由
- [ ] 验证启动

### Phase 2 — 前端重构
- [ ] 通用 TaskList / TaskCard / FileUpload 组件
- [ ] 模块注册表 + 路由分发
- [ ] 从 Tool 提取 model_diff/ 模块
- [ ] 移除 inline mock

### Phase 3 — 扩展验证
- [ ] 加第二个模块，验证 core 无改动
