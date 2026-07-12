# OpenCodeWiki

**团队级多仓库智能代码知识库** —— 基于 codebase-memory-mcp 代码语义图谱 + 混合检索（BM25 + 向量 RRF）+ 两阶段 LLM 搜索。

![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## ⚡ 快速开始

要求 Node.js ≥ 22.5（内置 `node:sqlite`）和 [codebase-memory-mcp](https://github.com/antigravity-ai/codebase-memory-mcp) 二进制。

### 1. 克隆与安装

```bash
git clone https://github.com/your/opencodewiki.git
cd opencodewiki

# 安装依赖（自动解压 vendor/libvips，无需外网）
npm run setup
```

### 2. 索引你的仓库

```bash
# 注册并索引一个仓库
npm run index ~/Code/my-project

# 注册多个仓库
npm run index ~/Code/service-a
npm run index ~/Code/service-b

# 监听模式：文件变更自动增量同步
npm run watch my-project
```

### 3. 启动 Web 控制台

```bash
npm start
# → http://localhost:4747
```

### 4. 生成 Wiki 实体

```bash
# 为一个仓库自动生成全部实体概念
bash scripts/wiki-entity.sh generate ~/Code/my-project

# 指定概念名
bash scripts/wiki-entity.sh generate ~/Code/my-project 问答引擎 索引系统

# 列出已有实体
bash scripts/wiki-entity.sh list
```

### 5. 运行测试

```bash
# 运行全部测试（84+ 个用例，覆盖 13 个套件）
npx tsx --test src/server/knowledge-db.test.ts src/server/entity-service.test.ts src/server/migrate-entities.test.ts src/server/qa-store.test.ts src/server/search-service.test.ts src/server/wiki-page-service.test.ts src/server/entity-api.test.ts src/server/link-entities.test.ts src/server/wiki-entity.test.ts 2>&1 | tail -10
```

---

## 📖 Wiki 实体系统

OpenCodeWiki 的实体系统帮助团队在代码知识库之上构建结构化的概念 wiki。

### 实体（Entity）

实体是代码库中的核心概念（模块、类、功能、框架等），每个实体包含：

| 字段 | 说明 | 来源 |
|------|------|------|
| `slug` | 唯一标识（如 `qa-engine`） | 自动生成 |
| `name` | 显示名称（如 `问答引擎`） | 自动/人工 |
| `definition` | 一句话定义 | LLM 生成 |
| `status` | `draft` → `reviewed` → `published` | 人工审核 |
| `files` | 关联的代码文件 | 自动关联 |
| `relations` | 实体间关系（`depends-on` / `part-of` / `related`） | LLM 提取 |
| `content` | 详细 Wiki 正文（Markdown） | 人工编辑 |

实体数据存储在 `~/.opencodewiki/knowledge.db`（SQLite + FTS5 全文搜索），每个实体也对应一个 `.md` 文件在 `~/.opencodewiki/pages/entities/`。

### #Q 问答沉淀

团队在 QA 界面中的高质量问答可以校准为标准答案：

- 每个 QA 回答可标记为 **标准答案**（calibrated）
- 问题通过 FTS5 索引，支持全文搜索
- **双路路由**：新问题时自动匹配 ≥0.85 置信度的标准答案直接返回，0.5~0.85 推荐相似问题，<0.5 走 LLM 生成
- QA 与实体自动关联：回答内容中提及的实体名或 `#slug` 标记自动关联到 `entity_qa` 表

### 实体详情页

访问 `http://localhost:4747/api/wiki/entities/<slug>` 或通过首页搜索可查看：

- 实体名称 + 状态标记（草稿/已校准/已发布）
- 一句话定义
- 关联代码文件列表
- Wiki 正文（Markdown 渲染）
- 上下游关系图（Mermaid 流程图）
- 右侧关联 #Q 面板（已校准问题标注绿标）

### 搜索实体

```bash
# 通过 API 搜索
curl http://localhost:4747/api/wiki/entities/search?q=引擎

# 获取热门实体
curl http://localhost:4747/api/wiki/entities/hot

# 查看实体关联的 QA 问题
curl http://localhost:4747/api/wiki/entities/qa-engine/qa
```

### 实体生命周期

```
[LLM 生成骨架] → draft → [人工校准] → reviewed → [发布] → published
      │                                                    │
      └── 自动关联代码文件 + 实体关系                       └── 生成 .md Wiki 页面
```


## 🧠 检索流水线

```
                    ┌──────────────────────────────────────┐
                    │       Web UI (SSE 流式回答)            │
                    └──────────────┬───────────────────────┘
                                   │ Q&A 请求
                                   ▼
                    ┌──────────────────────────────────────┐
                    │   意图分析 (LLM) → english_query      │
                    └──────────────┬───────────────────────┘
                                   │ searchTerms + chineseTerms
                                   ▼
                    ┌──────────────────────────────────────┐
                    │         第 1 轮搜索                    │
                    │  ├─ BM25 搜英文关键词                  │
                    │  └─ search_code grep 搜中文            │
                    └──────────────┬───────────────────────┘
                                   │ 候选文件列表
                                   ▼
                    ┌──────────────────────────────────────┐
                    │   LLM 筛选 → 选文件 + 提新搜索词       │
                    └──────────────┬───────────────────────┘
                                   │ 选中文件 + 新词
                                   ▼
                    ┌──────────────────────────────────────┐
                    │         第 2 轮搜索                    │
                    │  ├─ 并行深读选中文件源码               │
                    │  └─ 新词 BM25 补搜                    │
                    └──────────────┬───────────────────────┘
                                   │ 合并结果
                                   ▼
                    ┌──────────────────────────────────────┐
                    │   LLM 生成回答 + 源码引用              │
                    └──────────────────────────────────────┘
```

### 6 维意图路由

| Intent | 触发场景 | 搜索策略 |
|--------|---------|---------|
| `what-is` | 这是什么功能 / 代码做了什么 | BM25 + grep + 两阶段深读 |
| `where-is` | 定义在哪里 / 实现在哪 | name_pattern 符号匹配 + BM25 |
| `how-to` | 怎么用 / 如何调用 | BM25 + 上下文展开 |
| `why-error` | 为什么报错 / 分析堆栈 | BM25 + grep 错误码 |
| `what-structure` | 架构是什么 / 模块关系 | BM25 + 文件名扫描 |
| `what-impact` | 改了影响谁 / 谁在调用 | trace_path 调用链 |

---

## 📊 评测

内置自动化 QA 回答质量评测（以 Claude 回答为参考基准）：

```bash
# 跑评测
bash qa-eval/eval.sh 001   # 用例 001：what-is + TypeScript
bash qa-eval/eval.sh 002   # 用例 002：how-to + TypeScript
bash qa-eval/eval.sh 003   # 用例 003：where-is + C++

# 查看汇总
cat qa-eval/METRICS.md
```

| 用例 | Intent | 语言 | 分数 |
|------|--------|------|------|
| 001 kcode 小助手 vs 任务流 | what-is | TypeScript | **17~18** |
| 002 kcode 插件系统 | how-to | TypeScript | **17** |
| 003 llama.cpp batch 推理 | where-is | C++ | **17** |

---

## ⚙️ 配置

编辑 `~/.opencodewiki/config.json`：

```json
{
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash"
}
```

---

## 📂 项目结构

```
opencodewiki/
├── src/server/
│   ├── knowledge-db.ts      # knowledge.db schema + 连接单例（SQLite + FTS5）
│   ├── entity-service.ts    # 实体 CRUD（替换 JSON 文件存储）
│   ├── search-service.ts    # 统一搜索（实体 + QA，FTS5）
│   ├── migrate-entities.ts  # JSON → SQLite 迁移脚本
│   ├── wiki-page-service.ts # Wiki .md 页面生命周期管理（frontmatter 解析）
│   ├── qa-store.ts          # #Q QA 存储（SQLite + FTS5 全文索引）
│   ├── qa-endpoint.ts       # QA 入口：双路路由（直接命中/LLM）+ SSE 流式
│   ├── qa-resolver.ts       # 意图引擎 + 两阶段搜索
│   ├── cbm-bridge.ts        # codebase-memory-mcp 桥接层
│   ├── codegraph-bridge.ts  # REST API 与路由（历史命名）
│   └── server.ts            # Express 主服务 + 所有 API 路由
├── src/wiki/
│   └── entity.html          # 实体详情页（混合渲染 + #Q 面板 + 关系图）
├── scripts/
│   ├── index.mjs            # 仓库注册与索引
│   ├── reindex.mjs          # 增量监听 + 重新索引
│   ├── wiki.mjs             # Wiki 页面生成
│   └── wiki-entity.sh       # 实体骨架生成脚本
├── qa-eval/
│   ├── cases/               # 评测用例
│   ├── eval.sh              # 评测入口
│   └── METRICS.md           # 评分历史
└── vendor/                  # 离线第三方依赖
```

---

## 📜 主要开源组件

| 组件 | 用途 | 协议 |
|------|------|------|
| [codebase-memory-mcp](https://github.com/antigravity-ai/codebase-memory-mcp) | 代码语义图谱索引与 MCP 桥接 | MIT |
| [@xenova/transformers](https://github.com/huggingface/transformers.js) | 本地 ONNX Embedding 推理 | Apache-2.0 |
| [Express](https://github.com/expressjs/express) | HTTP 服务框架 | MIT |
| [@agentclientprotocol/sdk](https://github.com/agentclientprotocol/sdk) | MCP 协议客户端 SDK | Apache-2.0 |
| [Highlight.js](https://github.com/highlightjs/highlight.js) | 代码高亮（vendor） | BSD-3-Clause |
| [marked](https://github.com/markedjs/marked) | Markdown 渲染（vendor） | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 图表渲染（vendor） | MIT |
| [SQLite (node:sqlite)](https://nodejs.org/api/sqlite.html) | 符号索引 + 数据存储，零编译依赖 | 内置 |

---

## License

MIT
