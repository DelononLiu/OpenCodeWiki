# OpenCodeWiki — AI Agent 开发指南

> **📖 先读 `PROJECT.md`** — 包含文件索引、API 定义、数据流。
> **📋 任务在 `TASKS.md`** — 每个任务包含涉及文件、状态。

## 项目定位

OpenCodeWiki — 基于 Tree‑sitter 的开源代码问答系统。底层引擎 codebase-memory-mcp（Go + SQLite）。
支持三种问答模式，通过 `~/.opencodewiki/config.json` 的 `qaMode` 字段切换。

## 项目结构

```
OpenCodeWiki/
├── package.json
├── scripts/
│   └── start.sh                  # 启动 TS 服务
├── src/
│   ├── python-agent/             # LangGraph Agent（Python + FastAPI）
│   │   ├── main.py               # FastAPI 入口 + SSE
│   │   ├── agent.py              # LangGraph agent + system prompt
│   │   ├── tools.py              # codegraph CLI 工具 + ripgrep
│   │   └── config.py             # 配置读取
│   ├── server/
│   │   ├── server.ts             # Express 入口 + 路由（原 codegraph-bridge）
│   │   ├── qa-endpoint.ts        # LLM + ACP 模式（旧，保留 fallback）
│   │   ├── handlers/
│   │   │   └── langgraph-handler.ts  # LangGraph TS 代理
│   │   ├── qa/                   # 共享模块
│   │   │   ├── session.ts        # Session CRUD
│   │   │   ├── sources.ts        # 源码引用解析
│   │   │   ├── prompt-utils.ts   # 分类/模板/翻译
│   │   │   └── types.ts          # 共享类型
│   │   ├── acp/                  # ACP 协议（旧）
│   │   ├── cbm-bridge.ts         # codebase-memory-mcp 桥接
│   │   ├── qa-resolver.ts        # 意图分析引擎
│   │   └── wiki-integration.ts   # Wiki 生成
│   └── index.ts                  # 导出入口
├── eval/
│   ├── cases/                    # 评测用例
│   ├── eval.sh                   # 评测运行器
│   └── METRICS.md                # 评测指标历史
├── vendor/
│   └── rg                        # ripgrep 二进制
└── docs/
    ├── 调研03-Agent框架选型.md
    └── superpowers/specs/        # 设计文档
```

## 三种问答模式

| 模式 | 配置 | 后端 | 技术栈 |
|------|------|------|--------|
| **LangGraph**（推荐） | `qaMode: "langgraph"` | Python FastAPI + LangGraph | Python |
| LLM | `qaMode: "llm"` | qa-endpoint.ts Express | TypeScript |
| ACP | `qaMode: "acp"` | qa-endpoint.ts + ACP 子进程 | TypeScript |

## 启动

```bash
npm run dev:all     # TS + Python Agent 一起启动
npm run dev         # 仅 TS 服务
npm run dev:agent   # 仅 Python Agent
npm run kill        # 停止所有服务
```

qaMode 从 `~/.opencodewiki/config.json` 的 `qaMode` 字段读取，也可通过 `OPENCODEWIKI_QA_MODE` 环境变量覆盖。

## 评测

```bash
cd eval
bash eval.sh 001    # 跑单个用例
```

结果自动更新到 `eval/METRICS.md`（每用例一行，非追加）。

## Wiki

Wiki 文档由 openwiki 生成，放在各仓库的 `.codegraph/wiki/` 目录下。
- 静态浏览：访问 `/<repoName>` 页面
- 作为 Agent 上下文：Agent 自动读取 `.codegraph/wiki/quickstart.md`

## 开发约定

1. 使用中文
2. 使用 TypeScript（后端）/ Python（Agent）
3. **不要自动提交代码** — 等待用户明确要求
4. 修改 server.ts 时注意 BASE_PATH 兼容
5. 新增工具注册在 `python-agent/tools.py` 的 `CODEGRAPH_TOOLS` 列表

## 新增 API 路由

在 `src/server/server.ts` 中添加 `app.post('/api/xxx', handler)`，注意 BASE_PATH 环境变量。
