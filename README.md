# OpenCodeWiki — 团队代码知识平台

**基于代码和问答的自进化团队知识平台**

![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![React](https://img.shields.io/badge/React-18-61dafb)
![License](https://img.shields.io/badge/license-MIT-green)

---

## TL;DR

注册代码仓库 → 团队成员提问 → Agent 基于代码库回答 → 高质量回答聚合为 Topic → 审核沉淀为 Wiki 页面。适合需要围绕代码库建立结构化知识的研发团队。

## 核心特性

代码库接入 → QA 问答 → Topic 聚合 → Wiki 沉淀

自进化知识生命周期：从代码源持续产生问答，高质量回答聚合为 Topic，经审核沉淀为 Wiki 页面，形成团队可复用的结构化知识库。

## 使用示例

```bash
# 注册一个代码仓库
curl -X POST http://localhost:8100/api/repos -H "Content-Type: application/json" \
  -d '{"path": "/home/user/Code/my-project"}'

# 提一个问答（SSE 流式返回）
curl -N http://localhost:8100/api/qa -H "Content-Type: application/json" \
  -d '{"question": "这个项目的入口在哪？", "repo": "my-project"}'

# 查看已校准的 QA 条目
curl http://localhost:8100/api/qa/entries?status=active
```

## 快速启动

```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100 --reload

# 前端开发
cd frontend && npm run dev

# 生产构建
cd frontend && npm run build
```

## Docker 部署

```bash
docker build -t opencodewiki .
docker run -d -p 8100:8100 -v ~/.opencodewiki:/root/.opencodewiki opencodewiki
```

挂载 `~/.opencodewiki` 以持久化 SQLite 数据。通过环境变量配置 LLM：

```bash
docker run -d -p 8100:8100 \
  -v ~/.opencodewiki:/root/.opencodewiki \
  -e LLM_API_KEY=sk-xxx \
  -e LLM_MODEL=deepseek-v4-flash \
  opencodewiki
```

## 环境要求

- Python 3.11+
- Node.js 18+
- codebase-memory-mcp CLI（代码索引引擎）

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.11+, FastAPI, LangGraph |
| 前端 | React 18, Vite 5, TypeScript, shadcn/ui, Tailwind CSS 3 |
| 数据库 | SQLite (Python sqlite3 标准库) |
| 引擎 | codebase-memory-mcp CLI |
| 测试 | pytest, Vitest |

## 项目结构

```
├── backend/               # FastAPI 后端
│   ├── main.py            # 入口 + 路由
│   ├── config.py          # LLM 配置
│   ├── database.py        # SQLite 初始化
│   ├── agent/             # LangGraph Agent 子系统
│   ├── stores/            # 数据访问层 (qa, topics, wiki)
│   └── tests/             # 单元测试
├── frontend/              # React SPA
│   └── src/
│       ├── pages/         # HomePage, WikiGlobalPage, WikiPage, QAPage, AdminPage, SettingsPage
│       ├── components/    # ui (shadcn) + layout
│       ├── api/           # API 客户端
│       ├── types/         # TypeScript 类型
│       └── hooks/         # 自定义 hooks (useSSE)
├── eval/                  # QA 质量评测套件
├── scripts/               # 启动与 Wiki 生成脚本
├── Dockerfile             # Docker 镜像构建
├── docs/                  # 设计文档与调研
│   ├── ARCHITECTURE.md    # 详细架构总览
│   └── superpowers/       # 开发过程归档 (specs + plans)
└── AGENTS.md              # AI Agent 开发指南
```

## 开发命令

```bash
# 运行测试
cd backend && python -m pytest          # 后端
cd frontend && npx vitest run            # 前端

# 运行 QA 评测
cd eval && bash run.sh

# Lint 检查
cd frontend && npx tsc --noEmit          # TypeScript 类型检查
```

## 架构

详细架构设计（数据流、模块说明、设计决策、变更历史）见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 配置

编辑 `~/.opencodewiki/config.json`：

```json
{
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash"
}
```

## 如何贡献

1. 先读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 和 [`AGENTS.md`](AGENTS.md)
2. 理解核心闭环：QA → Topic → Wiki
3. 提交 PR 前通过所有测试
4. 代码注释和 commit 消息使用中文

## License

MIT
