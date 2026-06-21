# codebase-memory-mcp 使用说明

> 替代 codegraph 作为 OpenCodeWiki 的索引引擎。
> 纯 C 静态二进制，native Tree-sitter，无 WASM OOM 问题。

---

## 安装

```bash
# 一键安装（二进制 ~15MB）
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash

# 或下载预编译二进制（无需安装脚本）
# https://github.com/DeusData/codebase-memory-mcp/releases/latest
```

安装后二进制在 `~/.codebase-memory/bin/codebase-memory-mcp`。

---

## 索引仓库

```bash
# 索引一个仓库（全量）
codebase-memory-mcp cli index_repository '{"repo_path": "/home/long2015/Code/llama.cpp"}'

# 快速模式（跳过非必要文件）
codebase-memory-mcp cli index_repository '{"repo_path": "/home/long2015/Code/llama.cpp", "mode": "fast"}'

# 查看索引状态
codebase-memory-mcp cli index_status '{"project_path": "/home/long2015/Code/llama.cpp"}'

# 列出所有已索引项目
codebase-memory-mcp cli list_projects '{}'
```

索引数据存储在 `.codebase-memory/graph.db`（项目根目录下）。

---

## 基本查询

```bash
# 搜索符号
codebase-memory-mcp cli search_graph '{
  "query": "classifyDomain",
  "project_path": "/home/long2015/Code/OpenCodeWiki"
}'

# 追踪调用链（谁调了它 + 它调了谁）
codebase-memory-mcp cli trace_path '{
  "symbol": "classifyDomain",
  "project_path": "/home/long2015/Code/OpenCodeWiki",
  "depth": 2
}'

# 获取架构概览（模块、热度、语言分布）
codebase-memory-mcp cli get_architecture '{
  "project_path": "/home/long2015/Code/OpenCodeWiki"
}'

# 获取源码片段
codebase-memory-mcp cli get_code_snippet '{
  "symbol": "classifyDomain",
  "project_path": "/home/long2015/Code/OpenCodeWiki"
}'
```

---

## 关键 CLI 命令对照

| 用途 | codegraph（旧） | codebase-memory-mcp（新） |
|---|---|---|
| 索引 | `codegraph index` | `cli index_repository` |
| 搜索 | `codegraph query` | `cli search_graph` |
| 调用者 | `codegraph_callers` | `cli trace_path`（depth 向上） |
| 被调用者 | `codegraph_callees` | `cli trace_path`（depth 向下） |
| 影响分析 | `codegraph_impact` | `cli trace_path` + `detect_changes` |
| 架构概览 | 无（codegraph-bridge 自行计算） | `cli get_architecture` |
| 源码 | 无 | `cli get_code_snippet` |
| 状态 | `codegraph status` | `cli index_status` |

---

## 集成到 OpenCodeWiki

在 `qa-resolver.ts` 中，把 `handler.execute(tool, args)` 替换为 `execSync('codebase-memory-mcp cli <tool> <args>')`。

每个 codegraph 工具映射到一个 codebase-memory-mcp CLI 命令，输出格式不同但结构相似（都是 JSON）。解析逻辑需要调整，但整体架构不变。
