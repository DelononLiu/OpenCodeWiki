# Taskit

通用任务平台。核心模式：

```
上传文件 → 创建 Task → 后台执行 → 查看结果
```

Task 是唯一的核心抽象。平台管理任务生命周期，不关心任务内容。
模型精度比对 (`tasks/model_diff/`) 是第一个任务类型，后续可扩展日志分析、数据报表等。

---

## 架构

```
src/
├── core/              # 平台层（所有任务共用）
│   ├── api/           # 通用 API 调用
│   ├── components/    # TopNav / TaskHistoryDrawer / AuthPage
│   └── pages/         # HomePage / TaskPage（按 task.module 路由）
│
├── tasks/             # 你的各种任务
│   ├── registry.ts    # 任务注册表
│   ├── _template/     # 新任务的模板
│   └── model_diff/    # 模型精度比对
│       ├── TaskForm.tsx    # 创建任务的表单
│       ├── ResultViewer.tsx # 任务结果展示
│       └── mockData.ts     # 开发用 mock 数据

backend/
├── core/              # 平台层
│   ├── middleware/     # JWT 认证
│   ├── lib/           # task-engine（subprocess 执行器）
│   └── routers/       # auth / files / tasks CRUD
│
├── tasks/             # 后端任务定义
│   ├── registry.ts    # 任务注册表
│   └── model_diff/
│       ├── runner.ts  # shell 命令模板 + stdout 解析
│       └── router.ts  # 任务专有路由（/layers）
```

**核心设计**：`Task` 表用 `module` + `params`(JSON) + `result`(JSON) 三个字段桥接前后端。一个表管所有任务类型。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| 后端 | Express + TypeScript |
| 数据库 | SQLite（Prisma ORM） |
| 认证 | JWT（passport.js） |
| 任务执行 | `subprocess("shell 命令")`，脚本语言无关 |

---

## 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 安装后端依赖
cd backend && npm install && cd ..

# 3. 初始化数据库
cd backend && npx prisma db push && cd ..

# 4. 一键启动前后端
npm run dev:all
# 后端 → http://localhost:8000
# 前端 → http://localhost:5173

# 或分别启动
npm run dev            # 仅前端
npm run dev:backend    # 仅后端
```

首次访问 `/` 会跳转到 `/login`，注册账号后自动登录。

---

## 任务生命周期

```
前端提交表单
  → POST /api/tasks { module, fileIds, params }
  → 创建 Task（status=pending）
  → 后台 subprocess(shell 命令)
  → 解析 stdout JSON → 存入 Task.result
  → 前端轮询 GET /api/tasks/:id → status=completed
  → 前端展示 ResultViewer
```

---

## 添加新任务

复制模板目录，改三处：

```bash
cp -r src/tasks/model_diff src/tasks/my_task
```

1. **`TaskForm.tsx`** — 上传什么文件、填什么参数
2. **`ResultViewer.tsx`** — 结果怎么展示
3. **`runner.ts`** — 调哪个 shell 脚本，怎么解析输出

然后在 `tasks/registry.ts` 注册：

```typescript
// src/tasks/registry.ts
MODULES.my_task = {
  name: '我的任务',
  icon: 'FileText',
  TaskForm: MyTaskForm,
  ResultViewer: MyTaskResult,
}
```

---

## API

### 通用（所有任务共享）
```
POST   /auth/register            注册
POST   /auth/login               登录 → JWT
POST   /api/files/upload         上传文件
POST   /api/tasks                创建任务 { module, fileIds, params }
GET    /api/tasks                任务列表（分页，可筛 module/status）
GET    /api/tasks/:id            任务详情（含 result）
POST   /api/tasks/:id/cancel     取消运行中任务
POST   /api/tasks/:id/retry      重试失败任务
```

### 任务专有
```
GET    /api/modules/model_diff/tasks/:id/layers?framework=xxx   层差异数据
```

---

## 项目结构

```
├── src/                    # 前端
│   ├── core/               # 平台
│   │   ├── api/            # HTTP 客户端
│   │   ├── components/     # 通用组件
│   │   └── pages/          # 路由页面
│   ├── tasks/              # 任务目录
│   │   ├── registry.ts     # 任务注册
│   │   └── model_diff/     # 模型比对任务
│   ├── stores/             # 状态管理
│   ├── types/              # 类型定义
│   └── App.tsx             # 路由入口
│
├── backend/                # 后端
│   ├── src/
│   │   ├── core/           # 平台
│   │   ├── tasks/          # 任务目录
│   │   └── index.ts        # 入口
│   └── prisma/             # 数据库 schema
│
├── runners/                # 外部 shell 脚本（和项目语言无关）
├── dev.sh                  # 一键启动
├── .env.development        # 开发环境配置
└── docs/                   # 设计文档
```
