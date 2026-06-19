# OpenCodeWiki

**团队级智能代码知识库** — 基于 Tree-sitter 的代码索引 + 混合检索 + LLM 驱动问答。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## 一图概览

```
用户提问 → 意图分类 → 混合检索(FT5 + 向量 + RRF) → cross-encoder 重排序 → LLM 回答
                             ↑
                     Tree-sitter AST 索引 (codegraph)
                             ↑
                     你的代码仓库 (最多 20 个)
```

---

## Quick Start

```bash
# 1. 克隆
git clone https://github.com/your/opencodewiki.git
cd opencodewiki

# 2. 安装依赖（自动处理 sharp/libvips，无需外网）
npm run setup

# 3. 索引你的仓库
npm run index ~/Code/my-project

# 4. 启动
npm start
# → http://localhost:4747
```

---

## 什么是 OpenCodeWiki？

传统代码问答工具（如 Cursor、Copilot）面向个人开发者单仓库场景。OpenCodeWiki 面向**团队级多仓库知识库**——索引 5-20 个仓库，让团队成员用自然语言提问，系统基于代码结构理解给出带引用来源的答案。

### 解决的问题

| 场景 | 之前 | 现在 |
|------|------|------|
| "支付流程在哪？" | 搜 `refund` 找不到 | 语义搜索匹配 `processRefund` |
| "改了订单服务影响谁？" | 凭记忆排查 | 调用图 + 影响分析 BFS |
| "这个模块怎么上线？" | 翻文档 | 检索 + LLM 回答，附代码引用 |
| "跨库查询怎么实现的？" | 分别搜每个库 | 一次提问，全库检索 |

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **代码索引** | Tree-sitter AST 解析 24+ 语言，SQLite FTS5 全文搜索 |
| **语义搜索** | all-MiniLM-L6-v2 嵌入，384 维，暴力余弦相似度 |
| **混合检索** | FTS5 + 向量 + RRF (k=60) 融合 |
| **重排序** | Ettin-reranker-32m-v1 cross-encoder 二次排序 |
| **调用图分析** | callers / callees / impact BFS 路径搜索 |
| **6 种意图** | what-is / where-is / how-to / why-error / what-structure / what-impact |
| **多仓库** | 支持 20 个仓库并行搜索，@repoName 路由 |
| **增量索引** | `npm run watch` 文件变更自动同步 |
| **REST API** | `/api/search`, `/api/qa`, `/api/reindex` |
| **Web UI** | SSE 流式回答，Markdown + 代码高亮 + Mermaid 图 |

---

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          Web UI (SSE)                          │
├─────────────────────────────────────────────────────────────────┤
│                     QA Endpoint (qa-endpoint.ts)                │
│  意图分类 → 领域分类 → pipeline 编排 → 模板选择 → LLM 调用     │
├─────────────────────────────────────────────────────────────────┤
│                  Pipeline (qa-resolver.ts)                      │
│  Intent → Tools → Hybrid Search → Rerank → Context → LLM       │
├──────────────────────────┬──────────────────────────────────────┤
│  向量搜索 (sqlite-vec)   │  codegraph (Tree-sitter + FTS5)     │
│  all-MiniLM-L6-v2 嵌入   │  符号索引 + 调用图 + 影响分析       │
│  ~/.opencodewiki/vectors │  .codegraph/codegraph.db             │
└──────────────────────────┴──────────────────────────────────────┘
```

### 数据流

```
用户提问
  → 意图识别 (6 种，纯规则)
  → 同时执行:
      ├─ FTS5 全文搜索 (codegraph)
      └─ 向量语义搜索 (all-MiniLM-L6-v2)
  → RRF 融合 → top-20
  → Ettin cross-encoder 重排序 → top-5
  → codegraph_context 展开定义
  → LLM 生成回答 (SSE 流式)
  → 引用解析 + 源码读取
```

---

## 安装

### 系统要求

- **Node.js** ≥ 22.5（内置 `node:sqlite`）
- **内存** ≥ 4GB（推荐 8GB）
- **存储** ≈ 50MB/仓库（索引 + 向量）
- **可选**: Python 3.12 + sentence-transformers（用于 cross-encoder 重排序）

### 安装步骤

```bash
git clone https://github.com/your/opencodewiki.git
cd opencodewiki

# 方式一: 完整安装（推荐）
npm run setup

# 方式二: 分步安装
npm install --ignore-scripts
node scripts/postinstall.mjs   # 安装 sharp libvips 等原生模块
```

### 模型文件

需要下载 ONNX 模型文件（约 22MB）：

| 模型 | 大小 | 用途 | 下载 |
|------|------|------|------|
| all-MiniLM-L6-v2 | 22MB | 代码嵌入 | [Modelscope](https://www.modelscope.cn/models/sentence-transformers/all-MiniLM-L6-v2/file/view/master/onnx/model_quint8_avx2.onnx) |
| ettin-reranker-32m-v1 | 31MB | 重排序(可选) | [Modelscope](https://www.modelscope.cn/models/cross-encoder/ettin-reranker-32m-v1/file/view/master/onnx/model_quint8_avx2.onnx) |

安装位置：`node_modules/@xenova/transformers/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx`

---

## 使用

### 索引仓库

```bash
# 索引单个仓库
npm run index ~/Code/my-project

# 索引多个仓库
npm run index ~/Code/service-a
npm run index ~/Code/service-b

# 查看已注册的仓库
curl http://localhost:4747/api/repos

# 增量同步（代码变更后）
npm run reindex my-project

# 监听模式（自动同步）
npm run watch my-project
```

### 问答

```bash
# Web 界面
open http://localhost:4747

# API
curl -X POST http://localhost:4747/api/qa \
  -H "Content-Type: application/json" \
  -d '{"question": "支付流程怎么实现的", "repo": "my-project"}'
```

### 跨库搜索

```bash
# 在所有仓库中搜索
curl -X POST ... -d '{"question": "@cross token 怎么验证"}' 

# 指定仓库
curl -X POST ... -d '{"question": "@auth-service 登录逻辑在哪"}'
```

---

## 意图体系

OpenCodeWiki 自动识别问题的意图，采用不同的检索策略：

| Intent | 触发词 | 检索策略 | 展开方式 |
|--------|--------|---------|---------|
| what-is | 是什么/describe/explain | 符号 + 向量 + RRF | context 定义展开 |
| where-is | 在哪里/defined in/locate | 精确符号名 | 最小展开 |
| how-to | 怎么用/how to/用法 | 符号 + 向量 + RRF | callers/callees |
| why-error | 报错/error/crash | grep 错误码 + 符号搜索 | context + 近邻分析 |
| what-structure | 架构/结构/module | 符号 + 向量 + chunk | 定义展开 + 类/模块级 |
| what-impact | 影响/impact/who calls | 符号 + 向量 + RRF | callers + impact BFS |

---

## 评测

```bash
# 检索质量评测
npm run eval:qa tiny          # 10 题快速验证（10 秒）
npm run eval:report           # 查看报告

# 回答质量评测（需 LLM API）
npm run eval:answer           # 10 题回答评测

# 自定义评测
npm run eval:qa sweqa         # SWE-QA 144 题
```

当前指标：

| 迭代 | Recall@5 | MRR | ROUGE-L |
|------|---------|-----|---------|
| 基线（纯 FTS5） | 47.3% | 0.3957 | — |
| + 混合检索 | 56.4% | 0.4692 | — |
| + 重排序 | **60.7%** | **0.4905** | — |
| 回答质量 | — | — | **22.2%** |

---

## 配置

编辑 `~/.opencodewiki/config.json`：

```json
{
  "apiKey": "sk-xxx",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "crossRepos": ["repo-a", "repo-b"]
}
```

或使用环境变量：

```bash
export LLM_API_KEY=sk-xxx
export LLM_BASE_URL=https://api.deepseek.com
export LLM_MODEL=deepseek-v4-flash
export EMBED_ENGINE=local
```

---

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 代码索引 | **codegraph** + Tree-sitter | AST 解析 24+ 语言 |
| 符号搜索 | **SQLite FTS5** | BM25 全文搜索 + LIKE + Levenshtein |
| 向量存储 | **node:sqlite** | 零 native build，暴力余弦搜索 |
| 嵌入模型 | **all-MiniLM-L6-v2** (384d) | 本地 ONNX 推理 |
| 重排序 | **Ettin-reranker-32m-v1** / Qwen3-Reranker-4B | cross-encoder |
| 运行时 | **Node.js 22+** | 内置 node:sqlite |
| 可视化 | **marked + highlight.js + mermaid** | Markdown / 代码高亮 / 图表 |

---

## 项目结构

```
opencodewiki/
├── src/server/          # 服务端
│   ├── qa-endpoint.ts   # QA 入口 + 模板 + LLM 调用
│   ├── qa-resolver.ts   # 意图分析 + pipeline 编排
│   ├── vector-store.mjs # 向量存储 + 搜索
│   ├── reranker.mjs     # cross-encoder 重排序
│   └── codegraph-bridge.ts # Express 服务 + API 路由
├── scripts/
│   ├── eval/            # 评测系统
│   │   ├── tiny.json    # 10 题评测集
│   │   ├── runner.mjs   # 检索评测
│   │   └── answer-runner.mjs # 回答评测
│   ├── setup-repo.mjs   # 仓库注册
│   └── reindex.mjs      # 重新索引 + 监听模式
├── engine/codegraph/    # codegraph 引擎 (submodule)
├── docs/                # 调研文档
└── vendor/              # 第三方依赖 (libvips 等)
```

---

## 贡献

```bash
# 开发模式
npm run dev

# 跑评测验证
npm run eval:qa tiny
npm run eval:report -v

# 提交前确保指标不降
```

欢迎 PR。大改动建议先开 issue 讨论。

---

## 对比

| 特性 | OpenCodeWiki | Sourcegraph Cody | Cursor | Aider |
|------|-------------|-----------------|--------|-------|
| 索引方式 | Tree-sitter + FTS5 + 向量 | SCIP + Lucene | Turbopuffer | Tree-sitter |
| 调用图 | ✅ BFS 影响分析 | ✅ 部分 | ❌ | ❌ |
| 混合检索 | ✅ FTS5 + 向量 + RRF | ✅ BM25 + 可选向量 | ❌ 纯向量 | ❌ |
| 跨仓库 | ✅ ≤20 库并行 | ✅ 大规模 | ❌ | ❌ |
| 离线部署 | ✅ | ❌ | ❌ | ✅ |
| 团队知识库 | ✅ | ✅ 企业版 | ❌ | ❌ |
| 重排序 | ✅ Ettin/Qwen3 | ✅ 点式模型 | ❌ | ❌ |

---

## License

MIT

---

*Built with [codegraph](https://github.com/colbymchenry/codegraph) · Tree-sitter 代码智能引擎*
