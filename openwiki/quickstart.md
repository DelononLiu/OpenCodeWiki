# OpenCodeWiki 快速入门（Quickstart）

> 一个自我进化的团队知识平台。注册代码仓库（repository），提出问题，并自动从 QA 答案构建结构化的 Wiki。

**核心循环：** 代码源导入（Code Source Ingestion）→ QA问答（QA Q&A）→ 主题聚合（Topic Aggregation）→ Wiki发布（Wiki Publication）

## TL;DR

注册代码仓库（repository）→ 团队成员提问 → Agent基于代码回答 → 高质量答案聚合为主题（Topic）→ 审核并发布为Wiki页面。

## 快速开始（Quick Start）

### 后端（Backend）

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --port 8000 --reload
```

### 前端（开发环境）

```bash
cd frontend
npm run dev
# Vite 将 /api 代理到 localhost:8000（生产环境为 8100 端口）
```

### Docker 部署（Deployment）

```bash
docker build -t opencodewiki .
docker run -d -p 8000:8000 \
  -v ~/.opencodewiki:/root/.opencodewiki \
  -e LLM_API_KEY=sk-xxx \
  -e LLM_MODEL=gpt-4o-mini \
  opencodewiki
```

挂载 `~/.opencodewiki/` 以持久化 SQLite 数据和配置。

## 配置（Configuration）

编辑 `~/.opencodewiki/config.json`：

```json
{
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}
```

配置级联（cascade）：**环境变量（env vars）> config.json > 硬编码默认值（hardcoded defaults）**。

| 环境变量（Env Variable） | 用途（Purpose） |
|---|---|
| `LLM_API_KEY` | 覆盖 API 密钥 |
| `LLM_MODEL` | 覆盖模型名称 |
| `CBM_BINARY` | codebase-memory-mcp 二进制文件路径 |
| `CODEGRAPH_BRIDGE_URL` | TS 桥接（bridge）URL |
| `OPENCODEWIKI_AGENT_ENABLE` | 启用/禁用 Agent（`true`/`false`） |

## 前提条件（Prerequisites）

- Python 3.11+
- Node.js 18+
- [codebase-memory-mcp](https://github.com/codegraph-ai/codebase-memory-mcp) CLI（代码索引引擎）

## 目录结构（Directory Structure）

```
OpenCodeWiki/
├── backend/               # FastAPI Python 后端
│   ├── main.py            # 入口 + 所有路由（712 行）
│   ├── config.py          # LLM 配置（环境变量 > 文件 > 默认值）
│   ├── database.py        # SQLite 双数据库初始化
│   ├── source_importer.py # Git/zip 源导入（source ingestion）
│   ├── agent/             # LangGraph Agent 子系统
│   ├── stores/            # 数据访问层（QA、主题、Wiki、源）
│   └── tests/             # pytest 单元测试（约 85+ 个测试用例）
├── frontend/              # React 18 SPA，使用 Vite 5
│   └── src/
│       ├── pages/         # 首页、WikiGlobal、Wiki、QA、管理、设置
│       ├── components/    # 布局 + shadcn/ui 组件
│       ├── api/           # API 客户端函数
│       ├── types/         # TypeScript 类型
│       └── hooks/         # useSSE 流式（streaming）钩子
├── eval/                  # QA 质量评估套件（eval suite）
├── scripts/               # 启动/Wiki 生成脚本
├── docs/                  # 架构设计文档
│   └── ARCHITECTURE.md    # 详细架构概述
├── AGENTS.md              # AI Agent 开发指南（中文）
└── Dockerfile             # 生产环境 Docker 构建
```

## 文档索引（Documentation Index）

| 页面（Page） | 描述（Description） |
|---|---|
| [架构（Architecture）](architecture.md) | 系统设计、分层架构、技术栈 |
| [数据模型（Data Model）](data-model.md) | SQLite 模式（schema）、JSON 注册表、实体关系 |
| [工作流（Workflows）](workflows.md) | QA 流式处理、Topic→Wiki 流水线（pipeline）、源管理 |
| [测试指南（Testing Guide）](testing.md) | 测试结构、质量规则、评估套件（eval suite） |
| `docs/ARCHITECTURE.md` | 原始架构设计文档（中文） |
| `AGENTS.md` | AI Agent 开发指南，含 TDD 规则（中文） |

## API 概览（API Overview）

所有端点（endpoint）位于 `/api/` 下，响应封装在 `{ok: bool, data?: any, error?: string}` 中。

| 分组（Group） | 关键端点（Key Endpoints） |
|---|---|
| **源（Sources）** | `GET/POST /api/sources`，`POST /api/sources/upload`，`POST /api/sources/{name}/sync`，`DELETE /api/sources/{name}` |
| **QA** | `POST /api/qa`（SSE 流式），`GET /api/qa/entries`，`POST /api/qa/entry/{qid}/calibrate`，`GET /api/qa/suggest` |
| **主题（Topics）** | `GET/POST /api/topics`，`POST /api/topics/analyze`，`POST /api/topics/{slug}/publish` |
| **Wiki** | `GET /api/wiki/modules`，`GET /api/wiki/{slug}` |
| **搜索** | `GET /api/search?q=...` |
| **设置（Settings）** | `GET/PUT /api/settings` |

## 前端路由（Frontend Routes）

| 路由（Route） | 页面（Page） | 用途（Purpose） |
|---|---|---|
| `/` | 首页（HomePage） | 搜索中心 + 仓库网格 + 统计 |
| `/wiki` | Wiki全局页（WikiGlobalPage） | 所有仓库和主题概览 |
| `/:repo` | Wiki页（WikiPage） | 每个仓库的 Wiki 阅读器，带侧边栏 |
| `/qa` | QA页（QAPage） | 跨仓库 QA 问答，支持流式（streaming） |
| `/admin` | 管理页（AdminPage） | QA 校准（calibration）+ 主题发布 |
| `/settings` | 设置页（SettingsPage） | 知识源管理 + 模型配置 |