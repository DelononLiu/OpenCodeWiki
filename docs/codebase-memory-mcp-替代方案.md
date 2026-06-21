# codebase-memory-mcp 替代 codegraph 方案

> 用 codebase-memory-mcp（纯 C 静态二进制 + native Tree-sitter）替换 `@colbymchenry/codegraph`（Node.js + WASM Tree-sitter）作为 OpenCodeWiki 的索引引擎。

---

## 架构变化

**之前：**
```
OpenCodeWiki → ToolHandler.execute('codegraph_xxx') → @colbymchenry/codegraph Node 库 → .codegraph/codegraph.db
```

**之后：**
```
OpenCodeWiki → CbmBridge.execTool('xxx') → codebase-memory-mcp CLI → ~/.cache/codebase-memory-mcp/<project>.db
```

| 维度 | codegraph | codebase-memory-mcp |
|------|-----------|-------------------|
| 引擎 | Node.js 库 | 纯 C 静态二进制 |
| 通讯 | 进程内调用（JS API） | CLI execSync（~10ms/次） |
| 输出 | markdown 文本需解析 | 标准 JSON |
| 存储 | `.codegraph/codegraph.db` 项目内 | `~/.cache/codebase-memory-mcp/<name>.db` |
| 速度 | WASM tree-sitter OOM 风险 | native tree-sitter，无 OOM |
| 索引 | `npx codegraph init --index` | `codebase-memory-mcp cli index_repository` |

---

## 工具映射表

| codegraph（旧） | codebase-memory-mcp（新） | 参数变化 |
|---|---|---|
| `codegraph_search` | `cli search_graph` | `query`→相同，`maxResults`→`limit`，`projectPath`→`project` |
| `codegraph_context` | `cli get_code_snippet` | `symbol`→`qualified_name`（全限定名），`projectPath`→`project` |
| `codegraph_callers` | `cli trace_path direction=inbound` | `symbol`→`function_name`，`limit`→`depth` |
| `codegraph_callees` | `cli trace_path direction=outbound` | 同上 |
| `codegraph_impact` | `cli trace_path direction=both` | 同上，额外支持 `detect_changes` |
| `codegraph_status` | `cli index_status` / `cli list_projects` | `projectPath`→`project`（项目名） |
| `codegraph_files` | `cli search_graph label=File` | 用 label 过滤 |
| `codegraph_node` | `cli get_code_snippet` | 需要 qualified_name |
| `codegraph_explore` | `cli search_code` | `pattern`替代`query`，支持 `mode=compact/full/files` |
| `codegraph query`（CLI） | `cli search_graph` | JSON 输出直接可用 |
| `codegraph init --index` | `cli index_repository` | `repo_path` 参数 |
| `codegraph sync` | `cli index_repository mode=fast` | 快速模式近似增量 |
| `get_architecture` | **新增** | codegraph 没有，替代手工 SQL |

---

## 项目名解析

codebase-memory-mcp 用项目名作为 key，由路径推导：

```
/home/long2015/Code/OpenCodeWiki
→ 去掉首 "/" + "/" 替换为 "-"
→ home-long2015-Code-OpenCodeWiki
```

```typescript
function repoPathToProjectName(repoPath: string): string {
  return repoPath.replace(/^\//, '').replace(/\//g, '-');
}
```

---

## 各命令输出格式对照

### search_graph（BM25 模式）

```json
// 输入
{"query": "classifyDomain", "project": "home-long2015-Code-OpenCodeWiki"}
// 输出
{"total":1,"results":[{"name":"classifyDomain","qualified_name":"...","label":"Function","file_path":"src/server/qa-endpoint.ts","start_line":535,"end_line":548,"rank":-18.15}],"has_more":false}
```

### search_graph（name_pattern 模式）

```json
// 输入
{"name_pattern": "classifyDomain", "project": "...", "include_connected": true}
// 输出
{"total":1,"results":[{"name":"classifyDomain","label":"Function","file_path":"src/server/qa-endpoint.ts","in_degree":2,"out_degree":0,"connected_names":["classifyQuestion","createQaEndpoint"],"signature":"(question: string)"}]}
```

### trace_path

```json
// 输入：direction=inbound
{"function_name":"classifyDomain","project":"...","depth":2,"direction":"inbound"}
// 输出
{"callers":[{"name":"classifyQuestion","hop":1},{"name":"createQaEndpoint","hop":1}]}
```

### get_code_snippet

```json
// 输入（必须用 qualified_name）
{"qualified_name":"...classifyDomain","project":"..."}
// 输出
{"name":"classifyDomain","file_path":"/abs/path/src/server/qa-endpoint.ts","start_line":535,"end_line":548,"source":"export function classifyDomain(...){...}","signature":"(question: string)","return_type":": Domain","is_exported":true,"callers":2,"callees":0}
```

### get_architecture

```json
{"total_nodes":565,"total_edges":1249,"node_labels":[...],"edge_types":[...],"languages":[...],"packages":[...],"entry_points":[...],"hotspots":[...],"boundaries":[...],"layers":[...],"clusters":[...],"file_tree":[...]}
```

### search_code（graph-augmented grep）

```json
// 输入
{"pattern":"classifyDomain","project":"...","mode":"compact"}
// 输出
{"results":[{"node":"classifyDomain","file":"src/server/qa-endpoint.ts","start_line":535,"end_line":548,"in_degree":2,"out_degree":0,"match_lines":[535]}],"total_grep_matches":3}
```

---

## PipelineMatch 映射规则

search_graph BM25 结果 → PipelineMatch：

```typescript
function searchGraphToMatches(jsonStr: string, repoName: string): PipelineMatch[] {
  const data = JSON.parse(jsonStr);
  if (!data.results?.length) return [];
  return data.results.map(r => ({
    name: r.name,
    filePath: r.file_path,
    startLine: r.start_line || 1,
    endLine: r.end_line || r.start_line || 1,
    kind: classifyCbmKind(r.label),  // Function/Class→definition, else→reference
    score: r.rank !== undefined ? Math.round(100 + r.rank) : 50,
    snippet: '',
    repo: repoName,
  }));
}
```

classifyCbmKind 映射：
- `Function` / `Method` / `Class` / `Interface` / `Type` → `'definition'`
- `Variable` / `Property` → `'declaration'`
- 其他 → `'reference'`

---

## 逐文件修改清单

### Iteration 0 — CbmBridge 基础设施

新建 `src/server/cbm-bridge.ts`

- `CbmBridge` 类，封装 `execSync` 调用 codebase-memory-mcp CLI
- `execTool(tool, args)` 接口与旧的 `handler.execute()` 签名兼容
- 参数映射：`projectPath` → `project`，`symbol` → 先 search 再取 qualified_name
- `repoPathToProjectName()` 静态方法
- 二进制检测 + 健康检查

### Iteration 1 — 替换 codegraph-bridge.ts

- 移除 `@colbymchenry/codegraph` 动态 import
- `initHandler()` → `new CbmBridge()`
- `openCodegraphDb()` → 删除（不再直接 SQLite）
- REST API 路由：`codegraph_xxx` → `search_graph` / `trace_path` / `get_code_snippet`
- 动态 Wiki 页面：用 `get_architecture` 数据替代 SQLite 查询
- `parseSearchText()` → 简化为 JSON 解析
- `search/searchCallers/searchImpact` → 适配 JSON 输出

### Iteration 2 — 替换 QA 管道

`src/server/qa-resolver.ts`：
- tool wrapper `rawSearch/rawContext/rawCallers/rawCallees/rawImpact` → 调用新 tool 名
- `parseResults()` → 重写为 JSON 解析
- `multiRepoSsearch()` → 取消 markdown 解析流程
- 向量搜索 DB 路径：`.codegraph/codegraph.db` → `~/.cache/codebase-memory-mcp/<name>.db`
- 图传播重打分：改为 `trace_path` 调用

`src/server/qa-endpoint.ts`：
- 6 个 domain processing flow 中的 tool 名更新
- 系统提示词中的搜索链路描述更新

### Iteration 3 — 替换 Wiki 生成

`src/server/wiki-integration.ts`：
- `generateWiki()`: SQLite 查询 → `get_architecture` + `search_graph`
- 保留 LLM 分组和页面生成逻辑

`scripts/wiki.mjs`：
- `queryCallEdges()` → `get_architecture().boundaries`
- `queryExportsByFile()` → `search_graph label=Function,Class,Interface,Method`
- `querySourceFiles()` → `get_architecture().file_tree`

### Iteration 4 — CLI 脚本 + ACP 集成

- `scripts/setup-repo.mjs`: `npx codegraph init` → `codebase-memory-mcp cli index_repository`
- `scripts/reindex.mjs`: `npx codegraph sync/index/status` → CLI 等价命令
- `scripts/eval/runner.mjs`: `codegraph query` → `search_graph`，DB 路径更新
- `src/server/acp/AcpClient.ts`: MCP server 注册更新

### Iteration 5 — 清理收尾

- `package.json` 移除 `@colbymchenry/codegraph` 依赖
- 全局 grep 确认无残留 `.codegraph` / `codegraph_` 引用
- 全链路测试

---

## 依赖关系

```
Iteration 0 (CbmBridge 类)
   ↓
Iteration 1 (codegraph-bridge.ts) ────────→ Iteration 3 (wiki 生成)
   ↓
Iteration 2 (qa-resolver, qa-endpoint)
   ↓
Iteration 4 (CLI 脚本 + ACP) ────────────  (与 Iteration 2 可并行)
   ↓
Iteration 5 (清理收尾)
```

Iteration 3（wiki 生成）与 Iteration 2（QA 管道）无依赖，可并行。
Iteration 4 CLI 脚本与 Iteration 1 有弱依赖（确认 tool 名），可微调后并行。

---

## 各迭代验证方法

| Iteration | 验证 |
|---|---|
| 0 | `node -e "new CbmBridge().execTool('index_status',...)"` 返回 JSON |
| 1 | 启动服务器，`curl /api/search -d '{"query":"classifyDomain"}'` → JSON |
| 2 | POST `/api/qa` → LLM 回答包含正确文件引用 |
| 3 | POST `/api/wiki/generate` → `module_tree.json` 生成成功 |
| 4 | `node scripts/setup-repo.mjs ~/Code/xxx` → 索引 + 注册 |
| 5 | `node scripts/eval/runner.mjs tiny` → Recall@5 对比基线 |
