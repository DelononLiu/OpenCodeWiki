# opencodewiki

团队级代码知识库。基于 Tree-sitter 的代码索引 + LLM 驱动的问答系统。

引擎 [codegraph](https://github.com/colbymchenry/codegraph) 作为 git submodule 管理（`engine/codegraph/`）。

## 两个阶段

OpenCodeWiki 的使用分为两个独立阶段：

### 阶段一：索引 & Wiki 生成（管理员操作）

将代码仓库**预先索引**，生成结构化知识图谱和 Wiki 文档。这一步是离线批处理，只在代码变更后需要重新执行。

| 命令 | 用途 |
|------|------|
| `npm run index <path>` | 首次 setup：`codegraph init --index` + 注册到 registry |
| `npm run reindex <name>` | 已有仓库强制重建索引 |
| `npm run wiki <path>` | 生成 Wiki 文档（基于 GitNexus 引擎） |

索引后的仓库记录在 `~/.opencodewiki/registry.json`，包含文件数、节点数、边数、VCS 类型等元数据。

Wiki 支持 `--force`（强制重生成）、`--lang zh`（LLM 翻译为中文）、`--extra-pages`（额外生成 external-api / core / hot-modules 页面）。

### 阶段二：QA 查询（用户使用）

启动服务后，用户通过 Web 界面提问。OpenCodeWiki 读取预建索引，通过 codegraph MCP 工具搜索代码、分析影响范围，LLM 结合搜索结果生成答案。

```bash
npm run dev    # 启动服务 → http://localhost:4747
```

问答页面：http://localhost:4747/qa

## 目录

```
├── engine/codegraph/       codegraph 引擎源码（git submodule，固定 commit）
├── src/
│   ├── server/
│   │   ├── codegraph-bridge.ts   HTTP API
│   │   └── qa-endpoint.ts        SSE 流式问答
│   ├── home/               首页
│   ├── qa/                 Q&A 页面
│   └── vendor/             CDN 资源
└── package.json            codegraph 依赖指向 "file:./engine/codegraph"
```

## 快速开始

```bash
# 1. 安装
git clone --recurse-submodules <repo-url>
npm install

# 2. 配置 LLM
mkdir -p ~/.opencodewiki
# 编辑 ~/.opencodewiki/config.json:
# {"apiKey":"sk-xxx","baseUrl":"https://api.openai.com/v1","model":"gpt-4o-mini"}

# === 阶段一：索引 ===

# 3. 初始化仓库索引
npm run index -- ~/Code/myproject

# 4. (可选) 生成 Wiki
npm run wiki -- ~/Code/myproject --lang zh

# === 阶段二：查询 ===

# 5. 启动服务
npm run dev
# → 打开 http://localhost:4747/qa 开始提问
```

## 引擎更新

```bash
cd engine/codegraph
git pull origin main
npm install && npm run build
cd ../..
git add engine/codegraph && git commit -m "chore: update codegraph"
# 更新后 rebuild 索引: npm run reindex -- <repo-name>
```

## 页面

| 地址 | 说明 |
|------|------|
| http://localhost:4747/ | 首页 / 仓库列表 |
| http://localhost:4747/qa | Q&A 问答 |

## API

### 问答

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/qa` | SSE 流式问答（`{ question, repo?, sessionId?, history? }`） |
| `GET` | `/api/qa/session/:id` | 会话历史 |

### 仓库管理

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/repos` | 列出已注册仓库（含索引统计） |
| `POST` | `/api/repos` | 注册仓库 `{ name, path }`（path 需有 `.codegraph/`） |
| `DELETE` | `/api/repos/:name` | 移除注册 |

### CodeGraph 工具

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/status` | 索引状态 |
| `POST` | `/api/search` | 代码搜索 |
| `POST` | `/api/context` | 符号上下文 |
| `POST` | `/api/impact` | 影响分析 |
| `POST` | `/api/callers` | 调用者 |
| `POST` | `/api/callees` | 被调用者 |
| `POST` | `/api/node` | 节点详情 |
| `POST` | `/api/explore` | 探索分析 |
| `POST` | `/api/files` | 文件列表 |

## 配置

所有配置通过 `~/.opencodewiki/config.json`，格式示例：

```json
{
  "apiKey": "sk-xxx",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

支持的环境变量（覆盖 config.json）：

| 变量 | 对应字段 | 默认值 |
|------|---------|--------|
| `OPENAI_API_KEY` | apiKey | — |
| `LLM_BASE_URL` | baseUrl | `https://api.openai.com/v1` |
| `LLM_MODEL` | model | `gpt-4o-mini` |

仓库列表存储在 `~/.opencodewiki/registry.json`。

## 任务跟踪

见 `TASKS.md`。
