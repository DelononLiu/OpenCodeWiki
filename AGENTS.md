# OpenCodeWiki — AI Agent 开发指南

> **📖 先读 `docs/ARCHITECTURE.md`** — 项目架构总览。

## 项目定位

OpenCodeWiki — 自进化知识工作台。核心闭环：**QA 问答 → Topic 聚合 → Wiki 固化**。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.11+, FastAPI, LangGraph |
| 前端 | React 18, Vite 5, TypeScript, shadcn/ui, Tailwind CSS 3, Recharts |
| Markdown | react-markdown, remark-gfm, react-syntax-highlighter (Prism + vscDarkPlus) |
| 数据库 | SQLite (Python sqlite3 标准库) |
| 引擎 | codebase-memory-mcp CLI（代码索引与搜索） |

## 项目结构

```
opencodewiki/
├── backend/                   # Python 全栈后端
│   ├── main.py                # FastAPI 入口 + 所有路由
│   ├── auth.py                # JWT 鉴权
│   ├── config.py              # 配置读取
│   ├── database.py            # SQLite 初始化
│   ├── sediment.py            # 问答沉淀（卡片/文章）
│   ├── knowledge/             # 知识索引（chunker/embedder/importer/item_index/vector_store）
│   ├── pipeline/              # 问答事件流水线
│   │   ├── events.py          # PipelineEvent 定义
│   │   ├── pipeline.py        # 流水线编排 + 插件注册（pipeline.on）
│   │   └── plugins/           # 插件（chat_complete/query_understand/search/rerank/system_info 等）
│   ├── stores/                # 数据访问层（kb/doc/items/reviews/session/task/users/wiki_tree）
│   ├── sync/                  # git_sync / svn_sync
│   ├── task_worker/           # 后台任务 worker
│   └── tests/                 # pytest 单测，按模块扁平命名（test_stores.py / test_api.py / ...）
├── frontend/                  # React SPA（测试与源码同目录，如 QAPage.test.tsx）
│   ├── src/
│   │   ├── pages/             # Home/QAPage/WikiGlobal/WikiNode/Sources/Cards/Fragments/Admin/Settings/Login/Register
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui 组件
│   │   │   └── layout/        # AppSidebar / BottomInput / ContentRightPanel / ContextToolbar
│   │   ├── api/               # client.ts / opencodewiki.ts
│   │   ├── types/             # TypeScript 类型
│   │   └── hooks/             # useSSE / useSessionHistory / useCodeKnoraSSE
├── docs/
│   ├── research/              # 调研/专利/模型文档
│   └── superpowers/           # plans/ 实施计划 + specs/ 设计文档（只读归档）
├── scripts/
│   ├── start.sh               # 启动脚本
│   ├── wiki-generate.sh       # Wiki 生成入口
│   └── crg-wiki.py            # CRG Wiki 生成器
├── eval/                      # QA 评测套件（run.sh + JSON 用例）
├── Dockerfile                 # Docker 镜像构建
└── AGENTS.md                  # 本文件
```

## 启动

```bash
# 后端
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100
# 前端开发 (Vite 代理 API 到 :8100)
cd frontend && npm run dev

# 生产 (Python 直接 serve 构建产物)
cd frontend && npm run build
```

## 服务管理

```bash
# 启动后端 (8100，不用 --reload 避免重启卡死)
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100

# 启动前端 (5180，自动代理 API 到 8100)
cd frontend && npx vite --port 5180

# 重启后端（先杀旧进程再启）
kill $(lsof -ti:8100) 2>/dev/null; sleep 1
cd backend && source .venv/bin/activate && uvicorn main:app --port 8100 
# 全部重启
kill $(lsof -ti:8100) 2>/dev/null; kill $(lsof -ti:5180) 2>/dev/null; sleep 1
cd /home/long2015/Code/OpenCodeWiki/backend && source .venv/bin/activate && uvicorn main:app --port 8100 --reload &
sleep 2
cd /home/long2015/Code/OpenCodeWiki/frontend && npx vite --port 5180 &
sleep 2
echo "后端 http://localhost:8100  前端 http://localhost:5180"

# 访问地址
# 知识源:   http://localhost:5180/sources
# 卡片/碎片: http://localhost:5180/cards | /fragments
# 审批:     http://localhost:5180/admin
# Wiki:     http://localhost:5180/wiki
```

## 开发铁律

1. **优先采用领域常规方案。** 遇到架构/流程/交互设计问题时，先想"业内通用的做法是什么"，再动手。不熟悉行业标准时先问。禁止自己发明"巧妙的"替代方案（如用自定义 HTTP header 传递 session_id 而不是先创建会话再流式）。
2. **每个 bugfix 必须带测试。** 找到根因 → 修代码 → 加回归测试 → 跑全量 → commit。没有例外。
3. **修复完成后必须给出总结。** 格式：**问题** → **根因** → **解决**。不超过 5 行。

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
| `/` | 重定向到 `/qa` | 首页不再独立 |
| `/qa`、`/qa/:sessionId` | QAPage | 跨库问答，URL 定位会话 |
| `/wiki`、`/wiki/:name` | WikiGlobalPage | 全局 Wiki 概览 / 指定 Wiki |
| `/wiki/node/:nodeId` | WikiNodePage | Wiki 节点详情 |
| `/cards` | CardsPage | 知识卡片（过滤/新增/引用） |
| `/fragments` | FragmentsPage | 知识碎片（沉淀/发布） |
| `/sources` | SourcesPage | 知识源管理 |
| `/admin` | AdminPage | 审批 + Topic 管理 |
| `/settings` | SettingsPage | 系统设置 |
| `/login`、`/register` | LoginPage / RegisterPage | 登录注册 |

## 开发约定

1. **使用中文** — 代码注释、commit 消息、变量命名优先中文
2. **Git commit 消息使用 Conventional Commits** — 小写前缀 + 中文描述，scope 选填，如 `feat: 新增...`、`fix(wiki): 修复...`、`chore: ...`、`docs: ...`
3. **前端** — shadcn/ui + Tailwind CSS，`src/index.css` 只放 Tailwind 指令与主题变量，不写自定义组件 CSS
4. **Topic 生命周期** — QA → Topic(pool) → Draft → approved → Wiki(published)
5. **自进化闭环** — 增长循环是核心业务流程，修改时注意保持闭环完整性
6. **API 响应格式** — `{ok: bool, data?: any, error?: string}`
7. **新增问答/检索插件** — 放在 `backend/pipeline/plugins/`，并在 `backend/pipeline/pipeline.py` 或 `backend/main.py` 中注册

## 禁止事项

1. **不要自动 push** — 所有提交后等待用户确认
2. **不要修改 `docs/superpowers/`** — 那是开发过程归档，详细设计记录，不修改
3. **不要修改 `frontend/dist/`** — 构建产物，由 `npm run build` 生成
4. **不要删除数据库文件** — `qa.db` / `knowledge.db` 在 `~/.opencodewiki/`

## TDD 纪律

> 修改代码后，必须手动运行相关测试确认通过，否则工作视为未完成。

**TDD 日常流程（适用于 AI 和人类开发者）：**

```
1. 写一个失败测试      → Red
2. 写最少代码让测试通过  → Green
3. 提交代码
```

**具体执行规则：**

| 改了什么 | 必须运行的测试 |
|---------|---------------|
| stores/*.py | `python -m pytest tests/test_stores.py tests/test_items.py tests/test_reviews.py tests/test_wiki_tree.py -v` |
| main.py 路由 / auth.py | `python -m pytest tests/test_api.py tests/test_auth.py -v` |
| pipeline/*.py（含 plugins） | `python -m pytest tests/test_pipeline.py tests/test_chat_complete.py tests/test_query_understand.py tests/test_search_plugins.py -v` |
| knowledge/*.py | `python -m pytest tests/test_chunker.py tests/test_embedder.py tests/test_importer.py tests/test_item_index.py tests/test_vector_store.py -v` |
| 前端组件/页面 | `npx vitest run src/pages/ src/components/ --reporter=verbose` |
| 前端 hooks/api | `npx vitest run src/hooks/ src/api/ --reporter=verbose` |
| 跨模块改动 | **跑全量：** 后端 `python -m pytest -v` + 前端 `npx vitest run` |

**禁止**：测试失败时提交代码、合并 PR、或声称工作完成。

> 后端命令默认在 `backend/`（venv 已激活）下执行；拿不准对应测试就运行全量。

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
3. **「边界测了吗？」** —— null/空字符串/负数/超出范围/列表为空 等
4. **「排序/筛选/分页测了顺序吗？」** —— 如果结果集有序，必须验证顺序，不能只验证条数
5. **「这个测试我删了，有人会发现吗？」** —— 如果删了不影响任何人对代码的信心，那就是凑数测试

### 审查流程

提交测试代码前（包括 AI 生成的），必须逐行过一遍上述清单。发现凑数测试的：

1. **要么删除** — 确认这个行为不值得测
2. **要么重写** — 改成验证具体行为

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
3. **读 `docs/superpowers/plans/`**（如有）了解实施计划细节
4. **收到问题后，先复述确认，再动手修改** — 用结构化的方式复述你理解的问题、涉及的文件、改动的思路，等待用户确认后再执行代码改动。禁止一上来直接改代码。
5. **改动后手动运行相关测试**（见上表），确认通过
