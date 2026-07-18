# OpenCodeWiki 架构总览

> **活文档** — 随项目持续更新。重大变更在末尾记录。
> 详细设计文档见 `docs/superpowers/specs/`，分阶段实施计划见 `docs/superpowers/plans/`。

---

## 项目定位

自进化知识工作台。核心闭环：

**代码库接入 → QA 问答 → Topic 聚合 → Wiki 沉淀**

从代码源持续产生问答，高质量回答经校准后聚合为 Topic，提炼审核后发布为 Wiki 页面，形成团队可复用的结构化知识库。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 运行时 | Python 3.11+, Node.js (codebase-memory-mcp CLI) |
| 后端框架 | FastAPI (单进程，`main.py` 即入口) |
| Agent 引擎 | LangGraph (ReAct + 自定义 StateGraph 意图路由) |
| LLM 接入 | OpenAI / Anthropic / DeepSeek 兼容 (通过 `config.py` 配置) |
| 数据库 | SQLite (Python `sqlite3` 标准库，WAL 模式)：`qa.db` + `knowledge.db` |
| 代码索引 | codebase-memory-mcp CLI (直连 subprocess，不再经过 TS Express) |
| 前端框架 | React 18, Vite 5, TypeScript |
| UI 组件 | shadcn/ui, Tailwind CSS 3 |
| 图表 | Recharts |
| 测试 | pytest (后端), Vitest (前端) |

---

## 项目结构

```
opencodewiki/
├── backend/                   # FastAPI 后端
│   ├── main.py                # 入口 + 全部 API 路由 + 静态文件
│   ├── config.py              # LLM/API 配置读取
│   ├── database.py            # SQLite 双库初始化 (qa.db / knowledge.db)
│   ├── agent/                 # LangGraph Agent 子系统
│   │   ├── agent.py           # ReAct Agent 配置 + system prompt
│   │   ├── graph.py           # StateGraph：意图分类 → 子图路由 → 回答
│   │   ├── tools.py           # codegraph CLI 工具绑定
│   │   └── wiki_builder.py    # Wiki 实体骨架生成 (LLM + CLI)
│   ├── stores/                # 数据访问层
│   │   ├── qa.py              # QA 条目 CRUD
│   │   ├── topics.py          # Topic 聚合 CRUD
│   │   └── wiki.py            # Wiki .md 页面文件操作
│   └── tests/
├── frontend/                  # React SPA
│   └── src/
│       ├── pages/             # 6 个页面组件
│       ├── components/
│       │   ├── ui/            # shadcn/ui 组件
│       │   └── layout/        # Header, LeftSidebar, BottomInput 等
│       ├── api/client.ts      # API 请求封装
│       ├── types/index.ts     # TypeScript 类型定义
│       └── hooks/useSSE.ts    # SSE 流式订阅 hook
├── eval/                      # QA 质量评测套件 (pytest + requests)
├── scripts/                   # 启动 / Wiki 生成脚本
├── Dockerfile                 # Docker 镜像构建
└── docs/
    ├── ARCHITECTURE.md        # 本文件
    ├── superpowers/
    │   ├── specs/             # 架构设计文档 (带日期)
    │   └── plans/             # 实施计划 (带日期)
    └── research/              # 调研/专利/模型文档
```

---

## 数据流

```
用户提问
    │
    ▼
[FastAPI /api/qa] ── SSE 流式响应 ──→ 前端
    │
    ├─ (agent 未启用) → 直接调用 LLM 回答
    │
    └─ (agent 启用) → [LangGraph StateGraph]
                          │
                    ┌─────┴──────┐
                    │ classify    │  LLM 判断意图 (what-is / where-is / how-to / …)
                    └─────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
         run_what-is  run_where-is  run_how-to  …
              │           │           │
              └───────────┼───────────┘
                          │  codebase-memory-mcp CLI (subprocess)
                          ▼
                    [合成回答 + 源码引用]
                          │
                          ▼
                    ┌─────────────┐
                    │  QA 条目存储  │  → qa.db (qa_entries)
                    │  (已校准/未校准)│
                    └──────┬──────┘
                           │ 定期 / 手动
                           ▼
                    ┌─────────────┐
                    │ Topic 聚合   │  → knowledge.db (topics + topic_qa)
                    │ Draft 提炼   │  → topic_drafts
                    │ 审核 → 发布   │  → .md 文件沉淀
                    └─────────────┘
```

---

## 核心业务模块

### 1. QA 问答 (`/qa`)

- 提问入口：前端 BottomInput / QAPage → `POST /api/qa`
- 返回方式：SSE 流式 (streaming) 逐 chunk 返回 LLM 回答
- 校准机制：高质量回答可标记为校准答案 (`PUT /api/qa/entry/{qid}/calibrate`)
- 存储：`qa.db` — `qa_entries` 表 + `calibrated_answers` 表

### 2. Topic 聚合 (`/admin`)

- 将语义相关的 QA 条目聚合为 Topic
- `POST /api/topics/analyze` — LLM 自动分析 QA 群并建议 Topic
- Draft 提炼 → 人工编辑 → 审核 → 发布为 Wiki 页面
- 存储：`knowledge.db` — `topics` / `topic_qa` / `topic_drafts` 表

### 3. Wiki 页面 (`/wiki`, `/:repo`)

- 发布后的 Topic 生成 `.md` 文件在 `~/.opencodewiki/pages/`
- 三种类型：entity, overview, qa-archive
- 首页联想搜索：API `/api/search` 检索 Topic + 热门 QA (`/api/qa/suggest`)

### 4. 审批台 (`/admin`)

- 左右对比视图：raw → edited → 预览
- 模块选择器（关联 wiki_module）
- 晋升操作：Draft → approved → Wiki(published)

### 5. 设置 (`/settings`)

- 知识源配置（仓库注册）：`registry.json` 管理
- LLM API 配置：`config.json` 管理 (apiKey / baseUrl / model / provider)

---

## 关键设计决策

| 决策 | 说明 |
|------|------|
| 双 SQLite 库 | `qa.db` 存问答，`knowledge.db` 存实体/Topic/Draft，解耦读写 |
| WAL 模式 | 高并发读不影响写 |
| LangGraph 意图路由 | classify → 子图，避免大模型在无关分支上浪费 token |
| codebase-memory-mcp CLI 直连 | 取消 TS Express 代理中间层，Python 直接 subprocess 调用 |
| SSE 流式 | 前端 useSSE hook 消费流式回答，提供打字机体验 |

---

## 技术变更历史

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 从 Node.js/Express 迁移到 Python FastAPI + LangGraph |
| 2026-07-18 | 目录重构：删除 vendor/，统一 backend/frontend 两级结构 |
| 2026-07-17 | UI 全局升级：Card 组件 + Wiki 欢迎页 + 首页样式丰富 |
| 2026-07-15 | QA-Wiki 反馈闭环设计：Topic 聚合 + Draft 审核流 |
| 2026-07-11 | Wiki Entity + QA 架构设计：双路路由 + SSE 流式 |
| 2026-07-08 | Wiki Entity 系统设计 |
| 2026-07-05 | QA 回答质量评测规范 |
