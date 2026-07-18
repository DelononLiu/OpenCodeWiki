# OpenCodeWiki — AI Agent 开发指南

> **📖 先读 `docs/ARCHITECTURE.md`** — 项目架构总览。

## 项目定位

OpenCodeWiki — 自进化知识工作台。核心闭环：**QA 问答 → Topic 聚合 → Wiki 固化**。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.11+, FastAPI, LangGraph |
| 前端 | React 18, Vite 5, TypeScript, shadcn/ui, Tailwind CSS 3, Recharts |
| 数据库 | SQLite (Python sqlite3 标准库) |
| 引擎 | codebase-memory-mcp CLI（代码索引与搜索） |

## 项目结构

```
opencodewiki/
├── backend/                   # Python 全栈后端
│   ├── main.py                # FastAPI 入口 + 所有路由
│   ├── config.py              # 配置读取
│   ├── database.py            # SQLite 初始化
│   ├── agent/                 # Agent 子系统
│   │   ├── agent.py           # Agent 配置 + system prompt
│   │   ├── graph.py           # LangGraph StateGraph
│   │   ├── tools.py           # codegraph CLI 工具
│   │   └── wiki_builder.py    # Wiki 实体构建
│   ├── stores/                # 数据访问层
│   │   ├── qa.py              # QA 条目 CRUD
│   │   ├── topics.py          # Topic 聚合
│   │   └── wiki.py            # Wiki 页面文件操作
│   └── tests/                 # 单元测试
│       ├── test_stores.py     # Topic 存储层测试
│       └── test_agent.py      # Agent 端到端测试
├── frontend/                  # React SPA
│   ├── src/
│   │   ├── pages/             # HomePage / WikiGlobalPage / WikiPage / QAPage / AdminPage / SettingsPage
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui 组件
│   │   │   └── layout/        # Header / Sidebar / BottomInput
│   │   ├── api/client.ts      # API 客户端
│   │   ├── types/             # TypeScript 类型
│   │   └── hooks/             # 自定义 hooks (useSSE)
│   └── tests/
├── docs/
│   ├── research/              # 调研/专利/模型文档
│   └── superpowers/specs/     # 设计文档
├── scripts/
│   ├── start.sh               # 启动脚本
│   ├── wiki-generate.sh       # Wiki 生成入口
│   └── crg-wiki.py            # CRG Wiki 生成器
├── eval/                      # QA 评测套件
├── Dockerfile                 # Docker 镜像构建
└── AGENTS.md                  # 本文件
```

## 启动

```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 --reload

# 前端开发 (Vite 代理 API 到 :8000)
cd frontend && npm run dev

# 生产 (Python 直接 serve 构建产物)
cd frontend && npm run build
```

## 服务管理

```bash
# 启动后端 (8100)
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100 --reload

# 启动前端 (5180，自动代理 API 到 8100)
cd frontend && npx vite --port 5180

# 重启后端（先杀旧进程再启）
kill $(lsof -ti:8100) 2>/dev/null; sleep 1
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100 --reload

# 全部重启
kill $(lsof -ti:8100) 2>/dev/null; kill $(lsof -ti:5180) 2>/dev/null; sleep 1
cd /home/long2015/Code/OpenCodeWiki/backend && source .venv/bin/activate && uvicorn main:app --port 8100 --reload &
sleep 2
cd /home/long2015/Code/OpenCodeWiki/frontend && npx vite --port 5180 &
sleep 2
echo "后端 http://localhost:8100  前端 http://localhost:5180"

# 访问地址
# 知识管理: http://localhost:5180/sources
# 知识沉淀: http://localhost:5180/admin
# Wiki:     http://localhost:5180/wiki
```

## 运行测试

```bash
# 后端 (pytest)
cd backend && source .venv/bin/activate && python -m pytest

# 前端 (Vitest)
cd frontend && npx vitest run

# QA 评测 (pytest + requests)
cd eval && source ../backend/.venv/bin/activate && bash run.sh
```

## URL 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 搜索 + 4 板块 |
| `/wiki` | WikiGlobalPage | 全局 Wiki 概览 |
| `/:repo` | WikiPage | 文档/topic，hash 定位内容 |
| `/qa` | QAPage | 跨库问答 |
| `/admin` | AdminPage | 审批 + Topic 管理 |
| `/settings` | SettingsPage | 知识源配置 |

## 开发约定

1. **使用中文** — 代码注释、commit 消息、变量命名优先中文
2. **Git commit 消息使用中文** — 清晰描述改动内容，不加英文前缀
3. **Python 后端** — 使用 FastAPI + sqlite3 标准库
4. **前端** — shadcn/ui + Tailwind CSS，不使用自定义 CSS 文件
5. **Topic 生命周期** — QA → Topic(pool) → Draft → approved → Wiki(published)
6. **自进化闭环** — 增长循环是核心业务流程，修改时注意保持闭环完整性
7. **API 响应格式** — `{ok: bool, data?: any, error?: string}`
8. **新增 Python 工具** — 注册在 `backend/agent/tools.py` 的 `CODEGRAPH_TOOLS` 列表

## 禁止事项

1. **不要自动 push** — 所有提交后等待用户确认
2. **不要修改 `docs/superpowers/`** — 那是开发过程归档，详细设计记录，不修改
3. **不要直接写入 `~/.opencodewiki/`** — 通过 API/Store 层操作数据
4. **不要修改 `frontend/dist/`** — 构建产物，由 `npm run build` 生成
5. **不要删除数据库文件** — `qa.db` / `knowledge.db` 在 `~/.opencodewiki/`

## TDD 纪律

> 修改代码后，必须手动运行相关测试确认通过，否则工作视为未完成。

**TDD 日常流程（适用于 AI 和人类开发者）：**

```
1. 写一个失败测试      → Red
2. 写最少代码让测试通过  → Green
3. 运行全量测试确认无回归 → 验证
4. 提交代码
```

**具体执行规则：**

| 改了什么 | 必须运行的测试 |
|---------|---------------|
| stores/\*.py | `python -m pytest backend/tests/test_stores/ -v` |
| main.py 路由 | `python -m pytest backend/tests/test_main/ -v` |
| agent/\*.py | `python -m pytest backend/tests/test_agent/ -v` |
| 前端组件/页面 | `npx vitest run src/pages/ src/components/ --reporter=verbose` |
| 前端 hooks | `npx vitest run src/hooks/ --reporter=verbose` |
| 跨模块改动 | **跑全量：** 后端 `python -m pytest backend/tests/ -v` + 前端 `npx vitest run` |

**禁止**：测试失败时提交代码、合并 PR、或声称工作完成。

## 测试质量问责

> 写凑数测试（为覆盖而覆盖、不验证业务行为的测试）等同于没写测试。
> 写凑数测试后声称"测试通过"属于工作未完成——与"改了代码不跑测试"性质相同。

### 凑数测试判定标准

一个测试被判定为**凑数**，当它满足以下任一条件：

| 凑数类型 | 示例 | 判定规则 |
|----------|------|---------|
| **裸调用** | `resp = client.get("/api/xxx")` + 只 `assert 200` | 没有验证任何业务行为 |
| **存在即正义** | `assert "data" in result` / `assert result is not None` | 没断言具体值，返回空也得过 |
| **宽松断言** | `assert len >= 0` / `assert result or True` | 断言永不失败，形同虚设 |
| **结构检查** | `assert isinstance(result, list)` + 没查内容 | 没验证**字段值** |
| **重复验证** | 多个测试用不同参数走同一路径，断言一模一样 | 只验了一条路径 |
| **边界盲区** | error/异常/空集合/None 等反向路径完全不测 | 只测了快乐路径 |
| **mock 无行为验证** | mock 了 LLM/DB 但没验证 mock 被正确调用了 | 不知道代码是否真用了 mock |

### 必须遵守的质量清单

写任何一个测试前，逐条自问并通过：

1. **「这个测试能抓到什么 bug？」** —— 必须能说出至少一种具体的失败场景
2. **「断言的值是固定的还是推导的？」** —— 必须断言具体值（"应当等于 X"），不能断言"存在"或"不为空"
3. **「反向路径测了吗？」** —— 如果正向是"有结果"，反向就必须有"无结果"测试
4. **「边界测了吗？」** —— null/空字符串/负数/超出范围/列表为空 等
5. **「排序/筛选/分页测了顺序吗？」** —— 如果结果集有序，必须验证顺序，不能只验证条数
6. **「这个测试我删了，有人会发现吗？」** —— 如果删了不影响任何人对代码的信心，那就是凑数测试

### 审查流程

提交测试代码前（包括 AI 生成的），必须逐行过一遍上述清单。发现凑数测试的：

1. **要么删除** — 确认这个行为不值得测
2. **要么重写** — 改成验证具体行为
3. **禁止** — 保留凑数测试来"凑覆盖率"

### AI 特别约束

AI 生成测试代码后，必须在回复中附上**质量自证声明**，逐条回答：

```
[质量自证]
- 验证的业务行为：______
- 断言了哪些具体值：______
- 反向/异常路径：______
- 边界条件：______
- 无凑数模式（宽松断言/存在即正义/裸调用）：______
```

缺失此声明则 AI 的测试工作视为未完成。

## AI 工作流程

1. **先读 `docs/ARCHITECTURE.md`** 了解完整架构
2. **读本文件**（AGENTS.md）了解开发和测试命令
3. **读相关 spec**（`docs/superpowers/specs/`）了解功能的设计背景
4. **读 `docs/superpowers/plans/`**（如有）了解实施计划细节
5. **动手前先列出改动的文件和理由**，等用户确认后再执行
6. **改动后手动运行相关测试**（见上表），确认通过
