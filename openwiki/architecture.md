# 架构概述

## 系统架构

OpenCodeWiki 采用 **3 层分层架构**，并包含一个 **Agentic RAG** 子系统。

```
┌─────────────────────────────────────────────────────────────┐
│                     React SPA（前端）                        │
│  HomePage │ WikiPage │ QAPage │ AdminPage │ SettingsPage     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────────┐
│              FastAPI 后端（backend/main.py）                  │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ 源管理       │  │ QA 路由      │  │ 主题/Wiki 路由   │   │
│  │ /api/sources │  │ /api/qa/*    │  │ /api/topics/*    │   │
│  └──────┬───────┘  └──────┬───────┘  └───────┬──────────┘   │
│         │                 │                   │              │
│  ┌──────▼─────────────────▼───────────────────▼──────────┐  │
│  │              存储层（数据访问）                         │  │
│  │  stores/qa.py │ stores/topics.py │ stores/wiki.py     │  │
│  │  stores/sources.py                                     │  │
│  └──────┬─────────────────┬───────────────────┬──────────┘  │
│         │                 │                   │              │
│  ┌──────▼─────┐  ┌───────▼────────┐  ┌───────▼──────────┐  │
│  │  QA 数据库  │  │ 知识数据库      │  │ 注册表 JSON      │  │
│  │  qa.db      │  │  knowledge.db  │  │  registry.json   │  │
│  │  (SQLite)   │  │  (SQLite)      │  │  (基于文件)      │  │
│  └────────────┘  └────────────────┘  └──────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Agent 子系统（LangGraph）                     │ │
│  │                                                       │ │
│  │  ┌──────────┐   ┌──────────────┐   ┌──────────────┐ │ │
│  │  │ 分类意图  │──▶│ route()      │──▶│ run_{intent} │ │ │
│  │  │ Classify  │   │ (条件边)     │   │ 子 Agent 执行│ │ │
│  │  │ Intent    │   │ (conditional)│   │ sub-agent    │ │ │
│  │  └──────────┘   └──────────────┘   └──────┬───────┘ │ │
│  │                                           │         │ │
│  │  ┌────────────────────────────────────────▼──────┐  │ │
│  │  │         12 个代码工具（agent/tools.py）        │  │ │
│  │  │  code_search │ code_context │ code_grep       │  │ │
│  │  │  code_callers │ code_callees │ code_explore   │  │ │
│  │  └──────────────────────┬────────────────────────┘  │ │
│  └─────────────────────────┼───────────────────────────┘ │
│                            │                              │
│  ┌─────────────────────────▼──────────────────────────┐  │
│  │        codebase-memory-mcp CLI（外部引擎）          │  │
│  │        符号搜索 │ 代码图 │ 索引状态                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 |
|---|---|
| **后端** | Python 3.11+, FastAPI, LangGraph, sqlite3 |
| **前端** | React 18, Vite 5, TypeScript 5, shadcn/ui, Tailwind CSS 3 |
| **图表** | Recharts |
| **Markdown** | marked + highlight.js + mermaid |
| **代码引擎** | codebase-memory-mcp CLI |
| **数据库** | SQLite (WAL 模式) + JSON 注册表文件 |
| **测试** | pytest 9.1+（后端）, Vitest + MSW + Testing Library（前端） |
| **评估** | pytest + requests + 基于 LLM 的评分 |
| **容器** | Docker (Python 3.11-slim) |

## 后端层

### 入口点 (`backend/main.py`) — 约 712 行

- FastAPI 应用程序，带有生命周期处理器（初始化两个 SQLite 数据库）
- 跨 8 个组（repos, sources, settings, documents, QA, wiki, topics, search）的 30+ 个 API 端点
- React SPA 生产构建 (`frontend/dist/`) 的静态文件服务器
- 用于 QA 对话的 SSE 流式端点 (`POST /api/qa`)
- 用于客户端路由的通配 SPA 路由

### 配置 (`backend/config.py`) — 67 行

从 `~/.opencodewiki/config.json` 读取。环境变量优先于配置文件，配置文件优先于硬编码默认值。

关键配置提供者：
- `load_config()` — 完整配置字典或空
- `get_llm_config()` — API 密钥、基础 URL、模型、供应商
- `get_codegraph_bridge_url()` — 可选的 TS 桥接
- `is_agent_enabled()` — 功能标志环境变量

### 数据库 (`backend/database.py`) — 177 行

使用 WAL 日志模式初始化两个 SQLite 数据库：

| 数据库 | 文件 | 表 |
|---|---|---|
| **QA 数据库** | `~/.opencodewiki/qa.db` | `qa_entries`, `calibrated_answers` |
| **知识数据库** | `~/.opencodewiki/knowledge.db` | `entities`, `entity_files`, `entity_qa`, `topics`, `topic_qa`, `topic_drafts` |

### 存储层（数据访问）

| 模块 | 文件 | 存储 | 用途 |
|---|---|---|---|
| `stores/qa.py` | 176 行 | `qa.db` | QA 条目 CRUD 及校准 |
| `stores/topics.py` | 121 行 | `knowledge.db` | 主题聚合 → 草稿 → 发布 |
| `stores/wiki.py` | 56 行 | 磁盘上的 `.md` 文件 | Wiki 页面读/写 |
| `stores/sources.py` | 85 行 | `registry.json` | 源注册表 CRUD |

### 源导入器 (`backend/source_importer.py`) — 208 行

管理代码和文档仓库的导入：

- **代码（git）：** `git clone` → `codebase-memory-mcp index` → openwiki build → 注册
- **代码（zip）：** 解压 → 索引 → openwiki → 注册
- **文档（git）：** 克隆 → 复制 `.md` 文件 → 注册
- **文档（zip）：** 解压 → 复制 `.md` → 注册
- **同步：** 代码 = `git pull` + 重建；文档 = 重新克隆 + 重新复制
- **移除：** 清理仓库、源、向量目录及注册表条目

## Agent 子系统

### 架构

OpenCodeWiki 使用 **LangGraph StateGraph** 配合意图路由：

```
问题 → [classify_intent] → [route（条件边）] → [run_{intent}] → END
```

7 个支持的意图，带有每个意图的递归限制和工具指导：

| 意图 | 递归限制 | 工具重点 |
|---|---|---|
| `where-is` | 10 | code_search |
| `what-is` | 20 | search → context |
| `how-to` | 25 | search → callers/callees |
| `why-error` | 30 | grep → search → callers |
| `what-impact` | 30 | search → callers → callees |
| `build` | 30 | grep → search（项目约束） |
| `general` | 20 | 组合 |

关键设计：`get_graph()` 单例、懒加载子 Agent、优雅的递归回退到直接 LLM 调用。

### 12 个代码工具（`agent/tools.py` — 403 行）

通过子进程封装 `codebase-memory-mcp` CLI：

| 工具 | 用途 |
|---|---|
| `code_list_repos` | 列出已索引的仓库（来自注册表） |
| `code_read_wiki` | 读取项目的 openwiki 文档 |
| `code_grep` | 通过 ripgrep 进行文本搜索 |
| `code_search` | 语义/符号搜索 |
| `code_context` | 完整的函数/类定义（带自动回退） |
| `code_callers` | 入站调用追踪 |
| `code_callees` | 出站调用追踪 |
| `code_impact` | 双向影响分析 |
| `code_files` | 按路径模式列出文件 |
| `code_node` | AST 节点详细信息 |
| `code_explore` | 广泛的模糊代码搜索 |
| `code_status` | 索引引擎健康状态 |

二进制发现：环境变量 → PATH → `~/.codebase-memory/bin/`。60 秒超时，10K 字符输出上限。

### Wiki 构建器（`agent/wiki_builder.py` — 150 行）

两阶段实体生成：骨架（符号搜索 → LLM 实体 JSON）→ 细节（300-500 字 markdown）。

## 前端层

| 方面 | 方法 |
|---|---|
| **路由** | react-router-dom v6 |
| **状态** | 无全局存储——纯本地状态（useState/useEffect） |
| **API 客户端** | 通用 `request<T>()` 封装，带有 `{ ok, data, error }` 信封 |
| **流式** | 自定义 `useSSE` hook 配合 AbortController |
| **样式** | Tailwind CSS，自定义赛博主题（cyber-blue, cyber-green） |
| **认证** | 硬编码管理员列表——无真实认证系统 |
| **测试** | Vitest + MSW（Mock Service Worker，无真实网络调用） |

## 关键架构决策

1. **无全局状态库**——每个页面独立获取自身数据
2. **双 SQLite 数据库**——QA 条目与知识实体/主题分离
3. **意图路由的 Agent**——在调用专用子 Agent 之前先分类问题类型
4. **基于文件的 Wiki 页面**——磁盘上的 `.md` 文件便于备份和编辑
5. **JSON 注册表**——用于源管理的轻量级元数据存储
6. **配置级联**——env > config.json > 默认值，以实现最大灵活性

## 源码概览

```
backend/
├── main.py              # 入口点，30+ 路由，SSE 流式
├── config.py            # LLM/配置环境级联
├── database.py          # SQLite 双初始化（qa.db + knowledge.db）
├── source_importer.py   # Git/zip 导入、同步、移除
├── agent/
│   ├── __init__.py      # 导出：build_agent, get_graph, CODEGRAPH_TOOLS
│   ├── agent.py         # 带有系统提示的 ReAct Agent
│   ├── graph.py         # 意图路由的 StateGraph
│   ├── tools.py         # 12 个 LangChain 工具封装
│   └── wiki_builder.py  # 实体骨架 + 细节生成
├── stores/
│   ├── __init__.py      # 重新导出所有存储函数
│   ├── qa.py            # QA CRUD + 校准
│   ├── topics.py        # 主题生命周期（汇聚→草稿→发布）
│   ├── wiki.py          # Wiki 页面文件操作
│   └── sources.py       # 注册表 JSON CRUD
└── tests/
    ├── conftest.py      # 固定装置（内存数据库、TestClient、模拟 LLM）
    ├── test_source_importer.py  # 17.6K — 导入/同步/移除测试
    ├── test_agent/
    ├── test_main/       # 路由测试（6 个文件）
    └── test_stores/     # 存储测试（4 个文件）

frontend/src/
├── main.tsx              # 入口：BrowserRouter → App
├── App.tsx               # 路由定义（6 条路由）
├── api/client.ts         # 所有 API 函数
├── types/index.ts        # TypeScript 接口
├── hooks/useSSE.ts       # SSE 流式 hook
├── pages/                # 6 个页面组件
├── components/           # ui/（button, card）+ layout/（header, sidebar, input）
└── mocks/                # 用于测试的 MSW 处理器
```

## 变更历史

| 日期 | 变更 | 源码 |
|---|---|---|
| 2025-07 | 源 API 端点 + CRUD | `backend/main.py`, `backend/stores/sources.py` |
| 2025-07 | 支持 git/zip 的源导入器 | `backend/source_importer.py` |
| 2025-07 | 带知识源文档的 Wiki 路由 | `backend/main.py` |
| 2025-07 | Wiki 侧边栏动态加载 | `frontend/src/components/layout/` |
| 2025-07 | openwiki 生成脚本 | `scripts/openwiki-generate.sh` |

原始设计文档（中文）请参见 `docs/ARCHITECTURE.md`。