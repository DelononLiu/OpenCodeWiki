# OpenCodeWiki

**团队级多仓库智能代码知识库** —— 基于 codebase-memory-mcp 代码语义图谱 + 混合检索（BM25 + 向量 RRF）+ 两阶段 LLM 搜索。

![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## ⚡ 快速开始

要求 Node.js ≥ 22.5 和 [codebase-memory-mcp](https://github.com/antigravity-ai/codebase-memory-mcp) 二进制。

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

---

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
│   ├── cbm-bridge.ts      # codebase-memory-mcp 桥接层
│   ├── codegraph-bridge.ts # REST API 与路由（历史命名）
│   ├── qa-endpoint.ts     # QA 入口：LLM 编排、SSE 流式
│   └── qa-resolver.ts     # 意图引擎 + 两阶段搜索
├── scripts/
│   ├── index.mjs           # 仓库注册与索引
│   ├── reindex.mjs         # 增量监听 + 重新索引
│   └── eval/               # 检索评测
├── qa-eval/
│   ├── cases/              # 评测用例
│   ├── eval.sh             # 评测入口
│   └── METRICS.md          # 评分历史
└── vendor/                 # 离线第三方依赖
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
