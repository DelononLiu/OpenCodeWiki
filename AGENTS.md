# OpenCodeWiki — AI Agent 开发指南

> **📖 先读 `docs/superpowers/specs/2026-07-17-wiki-ui-evolution-design.md`** — 架构设计文档。
> **📋 实施计划在 `docs/superpowers/plans/2026-07-17-opencodewiki-refactor.md`** — 分阶段任务。

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
├── src/python-agent/         # Python 全栈后端
│   ├── main.py               # FastAPI 入口 + 所有路由
│   ├── graph.py              # LangGraph StateGraph
│   ├── agent.py              # Agent 配置 + system prompt
│   ├── tools.py              # codegraph CLI 工具
│   ├── config.py             # 配置读取
│   ├── database.py           # SQLite 初始化
│   ├── store_qa.py           # QA 条目 CRUD
│   ├── store_wiki.py         # Wiki 页面文件操作
│   ├── store_entities.py     # 实体服务
│   ├── store_topics.py       # Topic 聚合
│   └── wiki_entity_builder.py
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── pages/            # HomePage / WikiPage / QAPage / AdminPage
│   │   ├── components/
│   │   │   ├── ui/           # shadcn/ui 组件
│   │   │   └── layout/       # Header / Sidebar / BottomInput
│   │   ├── api/client.ts     # API 客户端
│   │   ├── types/            # TypeScript 类型
│   │   └── hooks/            # 自定义 hooks (useSSE)
│   └── tests/
├── docs/
│   ├── superpowers/specs/    # 设计文档
│   └── superpowers/plans/    # 实施计划
├── vendor/
│   └── rg                    # ripgrep 二进制
├── eval/                     # QA 评测套件
└── AGENTS.md                 # 本文件
```

## 启动

```bash
# 后端
cd src/python-agent && source .venv/bin/activate && uvicorn main:app --port 8000 --reload

# 前端开发 (Vite 代理 API 到 :8000)
cd frontend && npm run dev

# 生产 (Python 直接 serve 构建产物)
cd frontend && npm run build
```

## URL 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 搜索 + 4 板块 |
| `/:repo` | WikiPage | 文档/topic，hash 定位内容 |
| `/qa` | QAPage | 跨库问答 |
| `/admin` | AdminPage | 审批 + Topic 管理 |

## 开发约定

1. **使用中文** — 代码注释、commit 消息、变量命名优先中文
2. **Git commit 消息使用中文** — 清晰描述改动内容，不加英文前缀
3. **Python 后端** — 使用 FastAPI + sqlite3 标准库
4. **前端** — shadcn/ui + Tailwind CSS，不使用自定义 CSS 文件
5. **Topic 生命周期** — QA → Topic(pool) → Draft → approved → Wiki(promoted)
6. **自进化闭环** — 增长循环是核心业务流程，修改时注意保持闭环完整性
7. **API 响应格式** — `{ok: bool, data?: any, error?: string}`
8. **新增 Python 工具** — 注册在 `tools.py` 的 `CODEGRAPH_TOOLS` 列表
