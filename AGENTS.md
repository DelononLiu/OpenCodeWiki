# OpenCodeWiki — AI Agent 开发指南

> **📖 先读 `docs/ARCHITECTURE.md`** — 项目架构总览。

## 项目定位

OpenCodeWiki — 自进化知识工作台。核心闭环：**QA 问答 → Topic 聚合 → Wiki 固化**。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.11+, FastAPI, LangGraph |
| 前端 | React 18, Vite 5, TypeScript, shadcn/ui, Tailwind CSS 3, Recharts |
| 数据库 | SQLite (Python sqlite3 标准库) |
| 引擎 | codebase-memory-mcp CLI（代码索引与搜索） |

## 项目结构

```
opencodewiki/
├── backend/                   # Python 全栈后端
│   ├── main.py                # FastAPI 入口 + 所有路由
│   ├── config.py              # 配置读取
│   ├── database.py            # SQLite 初始化
│   ├── agent/                 # Agent 子系统
│   │   ├── agent.py           # Agent 配置 + system prompt
│   │   ├── graph.py           # LangGraph StateGraph
│   │   ├── tools.py           # codegraph CLI 工具
│   │   └── wiki_builder.py    # Wiki 实体构建
│   ├── stores/                # 数据访问层
│   │   ├── qa.py              # QA 条目 CRUD
│   │   ├── topics.py          # Topic 聚合
│   │   └── wiki.py            # Wiki 页面文件操作
│   └── tests/                 # 单元测试
│       ├── test_stores.py     # Topic 存储层测试
│       └── test_agent.py      # Agent 端到端测试
├── frontend/                  # React SPA
│   ├── src/
│   │   ├── pages/             # HomePage / WikiGlobalPage / WikiPage / QAPage / AdminPage / SettingsPage
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui 组件
│   │   │   └── layout/        # Header / Sidebar / BottomInput
│   │   ├── api/client.ts      # API 客户端
│   │   ├── types/             # TypeScript 类型
│   │   └── hooks/             # 自定义 hooks (useSSE)
│   └── tests/
├── docs/
│   ├── research/              # 调研/专利/模型文档
│   └── superpowers/specs/     # 设计文档
├── scripts/
│   ├── start.sh               # 启动脚本
│   ├── wiki-generate.sh       # Wiki 生成入口
│   └── crg-wiki.py            # CRG Wiki 生成器
├── eval/                      # QA 评测套件
├── Dockerfile                 # Docker 镜像构建
└── AGENTS.md                  # 本文件
```

## 启动

```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 --reload

# 前端开发 (Vite 代理 API 到 :8000)
cd frontend && npm run dev

# 生产 (Python 直接 serve 构建产物)
cd frontend && npm run build
```

## 运行测试

```bash
# 后端 (pytest)
cd backend && source .venv/bin/activate && python -m pytest

# 前端 (Vitest)
cd frontend && npx vitest run

# QA 评测 (pytest + requests)
cd eval && source ../backend/.venv/bin/activate && bash run.sh
```

## URL 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 搜索 + 4 板块 |
| `/wiki` | WikiGlobalPage | 全局 Wiki 概览 |
| `/:repo` | WikiPage | 文档/topic，hash 定位内容 |
| `/qa` | QAPage | 跨库问答 |
| `/admin` | AdminPage | 审批 + Topic 管理 |
| `/settings` | SettingsPage | 知识源配置 |

## 开发约定

1. **使用中文** — 代码注释、commit 消息、变量命名优先中文
2. **Git commit 消息使用中文** — 清晰描述改动内容，不加英文前缀
3. **Python 后端** — 使用 FastAPI + sqlite3 标准库
4. **前端** — shadcn/ui + Tailwind CSS，不使用自定义 CSS 文件
5. **Topic 生命周期** — QA → Topic(pool) → Draft → approved → Wiki(published)
6. **自进化闭环** — 增长循环是核心业务流程，修改时注意保持闭环完整性
7. **API 响应格式** — `{ok: bool, data?: any, error?: string}`
8. **新增 Python 工具** — 注册在 `backend/agent/tools.py` 的 `CODEGRAPH_TOOLS` 列表

## 禁止事项

1. **不要自动 push** — 所有提交后等待用户确认
2. **不要修改 `docs/superpowers/`** — 那是开发过程归档，详细设计记录，不修改
3. **不要直接写入 `~/.opencodewiki/`** — 通过 API/Store 层操作数据
4. **不要修改 `frontend/dist/`** — 构建产物，由 `npm run build` 生成
5. **不要删除数据库文件** — `qa.db` / `knowledge.db` 在 `~/.opencodewiki/`

## AI 工作流程

1. **先读 `docs/ARCHITECTURE.md`** 了解完整架构
2. **读本文件**（AGENTS.md）了解开发和测试命令
3. **读相关 spec**（`docs/superpowers/specs/`）了解功能的设计背景
4. **动手前先列出改动的文件和理由**，等用户确认后再执行
