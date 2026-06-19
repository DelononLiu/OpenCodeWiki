# OpenCodeWiki

**团队级多仓库智能代码知识库** —— 基于 Tree-sitter AST 代码语义图谱 + 混合检索（Hybrid RAG）+ 零依赖本地轻量部署。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## 🎯 为什么需要 OpenCodeWiki？

当前的 AI 编程助手（如 Cursor、Copilot）极度擅长个人在单文件或单仓库内的代码续写与局部调整。但在现代团队协同与复杂系统演进中，我们面临着更深的技术壁垒：

- **跨库知识割裂**：业务被拆分在多个微服务或独立仓库中，AI 无法跨仓库分析全局调用链路与隐式依赖。
- **语义搜索失效**：传统的全局 `grep` 或局部字符串匹配，无法理解函数调用（Call Graph）与间接影响面。
- **知识无法沉淀**：大模型的单次对话转瞬即逝，团队缺乏一本随着代码变更而实时自愈、演进的"项目活字典"。

**OpenCodeWiki** 专为解决此痛点而生。它并发索引你团队的多个核心代码仓库，通过静态语法分析与多维检索流水线，打造全团队共享的深度代码资产维基与交互式 Q&A 中心。

### 场景对比

| 研发痛点场景 | 传统纯文本检索 (Before) | OpenCodeWiki 智能维基 (Now) |
|-------------|------------------------|----------------------------|
| **模糊功能定位** | 搜 `refund` 找不到任何本地硬编码字符串 | **语义搜索** 自动跨词根匹配到 `processRefund` 核心函数 |
| **上下游改动评估** | "改了订单服务影响谁？" 只能凭记忆和人工搜日志 | **调用图分析** 一键触发 Callers BFS 路径搜索，输出拓扑树 |
| **跨库流程串联** | 分别在多个微服务 IDE 窗口里来回切换查找 | **全局路由** 通过 `@cross` 宏一次提问，全库检索 |
| **新成员破冰入局** | 翻看半年前过期的 Confluence 文档或口耳相传 | **智能问答** 自动生成实时代码引用、Markdown 与 Mermaid 架构图 |

---

## ⚡ 快速开始 (Quick Start)

要求 Node.js ≥ 22.5。1 分钟即可在内网服务器完成部署。

### 1. 克隆与初始化

```bash
git clone https://github.com/your/opencodewiki.git
cd opencodewiki

# 自动处理原生模块（自动解压 vendor/libvips，0 Native Build 失败风险，无需外网）
npm run setup
```

### 2. 建立你的多仓库活索引

```bash
# 注册并开始索引数个独立的业务仓库
npm run index ~/Code/auth-service
npm run index ~/Code/payment-gateway
npm run index ~/Code/order-center

# 开启监听模式：文件变更时自动增量同步索引与向量
npm run watch order-center
```

### 3. 启动 Web 全景控制台

```bash
npm start
# → http://localhost:4747
```

---

## ⚙️ 技术内幕与检索流水线 (How It Works)

OpenCodeWiki 依托 Node.js 22 内置的 `node:sqlite` 作为数据底座，构建了一套混合检索与重排序流水线：

```
                ┌──────────────────────────────────────────────────┐
                │             Web UI (SSE 流式回答)                 │
                └────────────────────────┬─────────────────────────┘
                                         │ Q&A 请求
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │          意图路由器 (6-Intent Classification)     │
                └────────────────────────┬─────────────────────────┘
                                         │ 动态 Pipeline 编排
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │             混合检索与 RRF 互惠倒数融合           │
                └───────────────┬──────────────────┬───────────────┘
                                │                  │
                                ▼                  ▼
               ┌────────────────┐   ┌──────────────────────────────┐
               │  FTS5 符号检索  │   │  本地向量语义搜索             │
               │  (codegraph)   │   │  all-MiniLM-L6-v2 (ONNX)     │
               │  Tree-sitter   │   │  node:sqlite 暴力余弦相似度   │
               └────────────────┘   └──────────────────────────────┘
                                │                  │
                                └────────┬─────────┘
                                         │ top-20 粗筛
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │   Ettin-reranker-32m 二次重排序 (Cross-Encoder)   │
                └────────────────────────┬─────────────────────────┘
                                         │ top-5 精筛
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │  上下文增强 (Call-Graph BFS 影响树展开 + Chunk)    │
                └────────────────────────┬─────────────────────────┘
                                         │ 注入 Prompt
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │  LLM 生成回答 (附带精确源码引用与 Mermaid 图表)    │
                └──────────────────────────────────────────────────┘
```

### 🧠 6 维自动意图路由

| Intent | 核心触发词 | 检索策略 | 上下文展开方式 |
|--------|-----------|---------|--------------|
| `what-is` | 是什么 / describe / explain | 符号索引 + 向量 + RRF | 补全 AST 节点符号定义 |
| `where-is` | 在哪里 / defined in / locate | 精确符号名模糊定位 | 最小化路径展开 |
| `how-to` | 怎么用 / how to / 用法 | 符号 + 向量 + RRF | 提取 Callers/Callees 拓扑示例 |
| `why-error` | 报错 / error / crash | 符号搜索 + grep 错误码 | 临近上下文关联分析 |
| `what-structure` | 架构 / 结构 / module | 符号聚类 + 类/模块级 Chunk | 提取骨架，准备 Mermaid 图表 |
| `what-impact` | 影响 / impact / who calls | 跨库符号关系链 | **BFS 影响半径展开** |

---

## 📊 内置评测 (Benchmark)

OpenCodeWiki 内置自动化质量评测，基于团队自有问题和 SWE-QA 裁剪版数据集：

| 迭代阶段 | Recall@5 | MRR | ROUGE-L |
|----------|---------|-----|---------|
| **基线**（纯 FTS5 全文搜索） | 47.3% | 0.3957 | — |
| **+ 向量语义搜索 + RRF 融合** | 56.4% | 0.4692 | — |
| **+ Ettin-reranker 交叉编码重排** | **60.7%** | **0.4905** | — |
| **LLM 回答质量** | — | — | **22.2%** |

在本地随时运行：

```bash
npm run eval:qa tiny         # 检索评测（10 秒）
npm run eval:report          # 查看报告
npm run eval:answer          # 回答评测（需 LLM API）
```

---

## 🎛️ 配置与 API

### 全局配置

编辑 `~/.opencodewiki/config.json`（所有 SQLite DB、向量矩阵及 ONNX 模型都存储在此目录，不污染项目 Git 树）：

```json
{
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "crossRepos": ["auth-service", "payment-gateway", "order-center"]
}
```

### REST API

可集成到 CI/CD 流水线或企业机器人：

```bash
curl -X POST http://localhost:4747/api/qa \
  -H "Content-Type: application/json" \
  -d '{
    "question": "@payment-gateway 微信支付的回调签名验证在哪里？",
    "repo": "payment-gateway"
  }'
```

---

## 📂 项目结构

```
opencodewiki/
├── src/server/             # 服务端核心
│   ├── qa-endpoint.ts      # QA 入口：LLM 编排、模板选择、SSE 流式
│   ├── qa-resolver.ts      # 意图引擎：6 维意图分流、Pipeline 编排
│   ├── vector-store.mjs    # 语义存储：node:sqlite 暴力余弦相似度
│   ├── reranker.mjs        # 重排序：Ettin Cross-Encoder 适配器
│   └── codegraph-bridge.ts # REST API 与路由
├── scripts/
│   ├── eval/               # 评测系统：指标回归测试集
│   ├── setup-repo.mjs      # 仓库注册与索引
│   └── reindex.mjs         # 增量监听：fs.watch 自动同步
├── engine/codegraph/       # Tree-sitter 代码索引引擎（Git submodule）
└── vendor/                 # 离线第三方依赖（libvips 等）
```

---

## 🤝 贡献

```bash
# 开发模式
npm run dev

# 跑评测验证
npm run eval:qa tiny
npm run eval:report -v
```

**🚨 红线：任何改动必须确保 `Recall@5` 不下降，否则 CI 将拒绝合并。**

欢迎 PR。大改动建议先开 issue 讨论。

---

## 📜 主要开源组件

| 组件 | 用途 | 协议 |
|------|------|------|
| [codegraph](https://github.com/colbymchenry/codegraph) | Tree-sitter 代码索引与 MCP 桥接 | MIT |
| [@xenova/transformers](https://github.com/huggingface/transformers.js) | 本地 ONNX 推理引擎 | Apache 2.0 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | ONNX 跨平台运行时 | MIT |
| [sentence-transformers](https://github.com/UKPLab/sentence-transformers) | Python Cross-Encoder 重排序（可选） | Apache 2.0 |
| [Express](https://github.com/expressjs/express) | HTTP 服务框架 | MIT |
| [SQLite (node:sqlite)](https://nodejs.org/api/sqlite.html) | 符号索引 + 向量存储，零编译 | 内置 |

---

## License

MIT
