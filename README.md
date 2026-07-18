# OpenCodeWiki — 团队代码知识平台

**基于代码和问答的自进化团队知识平台**

## 核心特性

代码库接入 → QA 问答 → Topic 聚合 → Wiki 沉淀

自进化知识生命周期：从代码源持续产生问答，高质量回答聚合为 Topic，经审核沉淀为 Wiki 页面，形成团队可复用的结构化知识库。

## 快速启动

```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 --reload

# 前端开发
cd frontend && npm run dev

# 生产构建
cd frontend && npm run build
```

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
├── docs/                  # 设计文档与调研
└── AGENTS.md              # AI Agent 开发指南
```

## 配置

编辑 `~/.opencodewiki/config.json`：

```json
{
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash"
}
```

## License

MIT
