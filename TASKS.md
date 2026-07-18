# OpenCodeWiki — 任务注册中心

> **分支**: `opencodewiki`（可独立提取为 repo）
> **目标**: 将 OpenCodeWiki 底层引擎从 GitNexus 替换为基于 Tree‑sitter 的开源方案，分阶段演进。
>
> 每个 session 从这里开始。AI 读取此文件定位到具体任务，获取涉及文件列表后直接开工，无需重扫工程。
> **Phase 概述**详见 `PROJECT.md`。

## 任务格式

```markdown
## PX-XX: 任务标题

**涉及文件**: _待调研_ 或 文件路径列表
**调研步骤**: (涉及文件为空时，调研阶段填充)
**调研结果**: (调研后填充，含具体函数/行号)
**状态**: ⬜ 未开始 | 🔍 调研中 | 📋 已调研 | 🛠️ 实现中 | ✅ 已完成
```

---

## Phase 0: 分支与初始化（一次性）

在 GitNexus 仓库中创建 `opencodewiki` 分支，清理无关目录，初始化项目框架。

| 任务 | 说明 | 状态 |
|------|------|------|
| P0-01 | 分支创建 + 无关目录清理 | ✅ 已完成 |
| P0-02 | 初始化项目框架（package.json/tsconfig/start.sh） | ✅ 已完成 |
| P0-03 | 搬运 ACP 模块 | ✅ 已完成 |
| P0-04 | QA 端点适配 | ✅ 已完成 |

### P0-01~04: Phase 0 全量完成

**涉及文件**:
- `.gitignore` — 项目根忽略规则（node_modules, dist, .codegraph, .gitnexus）
- `package.json` — codegraph + express + cors + TypeScript 依赖
- `tsconfig.json` — ES2022 / NodeNext / strict
- `src/server/codegraph-bridge.ts` — Express HTTP API 包装 ToolHandler（9 路由）
- `src/server/qa-endpoint.ts` — SSE 流式问答端点（双模式）
- `src/acp/AcpClient.ts` — ACP 客户端封装
- `src/acp/AgentManager.ts` — Agent 进程管理
- `src/acp/callbacks.ts` — ACP 回调实现
- `src/acp/types.ts` — AcpMessageHandler, FileChange 类型
- `src/acp/index.ts` — 统一导出
- `src/index.ts` — 入口导出
- `qa/index.html` — Q&A 前端页面
- `home/index.html` — Wiki 概览页面
- `vendor/` — marked / highlight.js / mermaid
- `start.sh` — 启动脚本

**状态**: ✅ 已完成

---

## Phase 1: 底座迁移

将 OpenCodeWiki 的底层代码引擎从 GitNexus 替换为 **codegraph** (`@colbymchenry/codegraph`)，保持 Wiki + QA + 搜索功能不变。

### 迁移策略

- **增量模式**：在 `opencodewiki/` 内开发，**不修改**原 `opencodewiki/` 任何文件
- **独立 repo 视角**：按独立仓库组织，后续可直接抽出

| 任务 | 说明 | 状态 | 优先级 |
|------|------|------|--------|
| P1-01 | 完成 codegraph-bridge Express 路由 + 静态服务 + QA 集成（全功能） | ✅ 已完成 | P0 |
| P1-02 | search 回调从 gitnexus 改为 codegraph API | ✅ 已完成 | P0 |
| P1-03 | 更新 systemPrompt 中工具名和引用格式 | ✅ 已完成 | P0 |
| P1-04 | ACP Agent 模式 MCP 工具注册切换为 codegraph | ✅ 已完成 | P1 |
| P1-05 | 跨仓库搜索验证（`listRepos` 回调对接） | ✅ 已完成 | P1 |

### P1-01: 补全 codegraph-bridge Express 路由 + 静态服务 + QA 集成

**涉及文件**:
- `src/server/codegraph-bridge.ts` — 全功能重写，含 9 路由 + 静态服务 + QA 端点集成

**改动内容**:
- 修复 `ToolHandler` 导入路径为 `@colbymchenry/codegraph/dist/mcp/index.js`
- 添加 `CodeGraph.init()` 懒初始化，自动创建 `.codegraph/` 目录
- 添加静态文件服务：`/vendor/*` → vendor 目录（JS/CSS）
- 添加前端页面路由：`/` → 首页，`/qa` → QA
- 集成 `createQaEndpoint` 注册 `POST /api/qa`（SSE 流式问答）
- 添加 `GET /api/qa/session/:id` 会话查询
- 实现 `search` 回调调用 codegraph 搜索
- 将 `src/acp/` 移至 `src/server/acp/` 修复模块路径

**状态**: ✅ 已完成

### P1-02: search 回调从 gitnexus 改为 codegraph API

**涉及文件**:
- `src/server/qa-endpoint.ts` — `createQaEndpoint()` 的 `search` 参数是唯一依赖 gitnexus 的回调

**调研步骤**:
1. 读 `PROJECT.md` → `createQaEndpoint` 参数表确认 search 签名
2. 打开 `qa-endpoint.ts` 查看 search 如何被调用

**调研结果**:
- `search: (query, repo?) => Promise<{sources, flows?}>` — 接收搜索词和仓库名，返回源码片段和执行流
- 调用点：`qa-endpoint.ts:612`（单仓库）和 `:607`（跨仓库）
- sources 格式兼容 codegraph 返回的 `{ filePath, label, startLine, endLine, name }`

**实现概要**:
- `codegraph-bridge.ts` 的 search 回调先调 `codegraph_search` 获取候选结果
- 对前 3 个含符号名的结果并行调 `codegraph_context` 获取深度上下文
- 合并 context 文本为 `flows` 字段返回

**状态**: ✅ 已完成

### P1-03: 更新 systemPrompt 中工具名和引用格式

**涉及文件**:
- `src/server/qa-endpoint.ts:753` — 硬编码的 gitnexus 工具引用 `gitnexus_query → gitnexus_cypher → gitnexus_context → grep`

**调研步骤**:
1. 读 `PROJECT.md` → 确认期望的工具名
2. 打开 `qa-endpoint.ts` 定位 systemPrompt 字符串

**调研结果**:
- 第 753 行包含硬编码搜索链路：`gitnexus_query → gitnexus_cypher → gitnexus_context → grep`
- 引用路径格式：`relative/path/file.ts:line`（当前已适配 codegraph 的相对路径）

**实现概要**:
- `qa-endpoint.ts:753` systemPrompt 中搜索链路替换为 `codegraph_search → codegraph_context → codegraph_impact → grep`

**状态**: ✅ 已完成

### P1-04: ACP Agent 模式 MCP 工具注册切换为 codegraph

**涉及文件**:
- `src/server/acp/AcpClient.ts:80` — `createSession()` 的 `mcpServers` 从空数组改为注册 `codegraph serve --mcp` 作为 stdio MCP 服务器
- `package.json` — 添加 `@agentclientprotocol/sdk` 依赖

**调研结果**:
- codegraph 提供 `npx codegraph serve --mcp` 以 stdio 模式运行 MCP 服务器
- ACP `McpServerStdio` 类型支持直接配置命令和参数
- `AcpClient.ts:80` 之前 `mcpServers: []` 未注册任何 MCP 工具，ACP Agent 无法调用 codegraph

**实现概要**:
- `AcpClient.ts:80` 中 `mcpServers` 添加 codegraph 条目：`command: 'npx'`, `args: ['codegraph', 'serve', '--mcp', '--no-watch', '--path', cwd]`

**状态**: ✅ 已完成

### P1-05: 跨仓库搜索验证（`listRepos` 回调对接）

**涉及文件**:
- `src/server/codegraph-bridge.ts:270-280` — `listRepos` 回调已从 registry 读取仓库列表
- `src/server/codegraph-bridge.ts:237-260` — `search` 回调通过 `searchRepoPath` 支持 `projectPath` 过滤
- `src/server/codegraph-bridge.ts:262-268` — `resolveRepo` 返回 `{ storagePath, name }`
- `src/server/qa-endpoint.ts:602-670` — 跨仓库搜索循环，对每个 repo 并行调 search

**调研结果**:
- `listRepos` 返回 `{ name, stats }[]`，符合 `createQaEndpoint` 预期的 `{ name }[]`
- `search` 回调的 `projectPath` 参数被 codegraph 搜索工具原生支持（tools.js 有 `projectPathProperty`）
- 跨仓库模式链路：`listRepos() → resolveRepo().name → repoBaseMap.set(name, path.dirname(storagePath)) → search(query, name)`，路径验证正确

**状态**: ✅ 已完成

---

## 约定

- **状态标记**: ⬜ 未开始 | 🔍 调研中 | 📋 已调研 | 🛠️ 实现中 | ✅ 已完成
- 调研阶段填充 `调研步骤` 和 `调研结果`，实现阶段只读「涉及文件」列表
- 详情见 `AGENTS.md > 开发流程`
