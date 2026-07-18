# TDD 测试体系全面迁移 — 设计文档

> 日期：2026-07-18

## 背景

OpenCodeWiki 项目代码量已达 ~3800 行（后端 2100 + 前端 1700），测试覆盖率极低：

| 层 | 代码量 | 测试量 | 覆盖率 |
|---|---|---|---|
| 后端 stores/ | 353 行 | ~115 行（仅 topics） | ~11% |
| 后端 agent/ | 827 行 | ~150 行（E2E 脚本，非单元） | ~0% |
| 后端 main.py | 614 行 | 0 | 0% |
| 后端 database.py | 178 行 | 0 | 0% |
| 前端 src/ | ~1700 行 | ~52 行（仅 URL 构造） | ~3% |

在 AI 协作开发时代，修改代码需要测试安全网保证不引入回归。

## 目标

建立完整 TDD 测试体系，覆盖后端全部模块和前端关键模块，并将 TDD 纪律写入项目文档约束所有开发者（含 AI）。

## 方案：全面 TDD 迁移

### 后端测试架构

**基础设施：** pytest + 内存 SQLite + FastAPI TestClient + mock LLM

```
backend/tests/
├── conftest.py                # 全局 fixture：内存 DB、TestClient、mock LLM
├── test_stores/
│   ├── __init__.py
│   ├── test_qa.py             # QA CRUD 8-10 用例
│   ├── test_topics.py         # Topic CRUD（重构现有，扩展到 12 用例）
│   └── test_wiki.py           # Wiki 读写 4-6 用例
├── test_main/
│   ├── __init__.py
│   ├── test_qa_routes.py      # /api/qa 系列 6-8 用例
│   ├── test_topic_routes.py   # /api/topics 6-8 用例
│   ├── test_wiki_routes.py    # /api/wiki 4-6 用例
│   ├── test_settings_routes.py# 3-4 用例
│   └── test_search_routes.py  # 3-4 用例
└── test_agent/
    ├── __init__.py
    └── test_graph.py          # mock LLM，测试编排逻辑 6-8 用例
```

**隔离策略：** 所有测试使用 `:memory:` SQLite 数据库，mock 掉 `get_qa_db()` / `get_knowledge_db()` 返回测试专用连接。路由测试使用 FastAPI `TestClient`，不启动 uvicorn 进程。Agent 测试 mock `ChatOpenAI`/`ChatAnthropic`，不调真实 LLM。

### 前端测试架构

**基础设施：** Vitest + jsdom + @testing-library/react + MSW

```
frontend/vitest.config.ts              # 新增 jsdom 环境配置
frontend/src/test-setup.ts             # @testing-library/jest-dom 全局注册
frontend/src/mocks/
├── handlers.ts                        # MSW API mock handlers
└── server.ts                          # MSW server 实例

frontend/src/ 下就近存放测试：
├── api/client.test.ts                 # API 客户端（扩展现有 tests/api.test.ts）
├── hooks/useSSE.test.ts               # SSE 状态机（mock EventSource）
├── components/layout/
│   ├── Header.test.tsx                # 导航栏渲染
│   └── BottomInput.test.tsx           # 输入框交互
└── pages/
    ├── HomePage.test.tsx              # 搜索 + 板块
    ├── QAPage.test.tsx                # 提问流 + 答案展示
    ├── WikiPage.test.tsx              # Markdown 渲染
    └── AdminPage.test.tsx             # Topic 管理
```

### TDD 纪律（已写入 AGENTS.md）

- 所有代码修改必须手动运行相关测试确认通过
- 各修改范围对应具体测试命令
- 测试失败禁止提交代码或声称工作完成

## 实施计划

分四个阶段：

1. **后端测试基础设施 + conftest.py**
2. **后端 stores + main.py 路由测试**
3. **前端测试基础设施 + 组件/页面测试**
4. **Agent 测试 + 最终验证**
