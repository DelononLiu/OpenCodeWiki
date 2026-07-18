# 核心工作流（Core Workflows）

## 1. 源数据导入工作流（Source Ingestion Workflow）

```
User (UI/API)
  │
  ▼
POST /api/sources (git URL)   POST /api/sources/upload (zip)
  │                                 │
  ▼                                 ▼
source_importer.import_code_git()   source_importer.import_code_zip()
  │                                 │
  ├── git clone                     ├── unzip
  ├── codebase-memory-mcp index     ├── codebase-memory-mcp index
  └── openwiki generate             └── openwiki generate
  │                                 │
  ▼                                 ▼
stores/sources.create_source() → registry.json
```

**源类型（Source types）：** `code`（完整代码仓库，已索引 + 已生成 wiki）或 `docs`（仅 Markdown）。

**存储布局（Storage layout）：**
- `~/.opencodewiki/repos/{name}/` — 克隆的代码仓库
- `~/.opencodewiki/pages/sources/{name}/` — 文档 `.md` 文件
- `~/.opencodewiki/vectors/{name}.vec.db*` — 向量索引（vector index）文件

**同步流程（Sync flow）：** `POST /api/sources/{name}/sync` → 代码：`git pull` + 重建 openwiki；文档：重新克隆 + 重新复制。

**删除流程（Delete flow）：** `DELETE /api/sources/{name}` → 移除 repo/sources/vectors 目录 + 注册表（registry）条目。

### 关键源文件（Key source files）
- `backend/source_importer.py` — 导入/同步/删除逻辑
- `backend/stores/sources.py` — 注册表 CRUD
- `backend/main.py` 中有关源 API 端点（source API endpoints）的代码行
- `backend/agent/tools.py` — 导入器使用的 `CBM_BINARY` 常量

## 2. 问答流式工作流（QA Streaming Workflow）

```
User (QAPage)
  │
  ├── POST /api/qa {question, repo}
  │
  ▼
main.py → _qa_event_stream()
  │
  ▼
get_graph().ainvoke()  (LangGraph StateGraph)
  │
  ├── [classify_intent] → LLM 对问题类型进行分类
  │     (where-is, what-is, how-to, why-error, what-impact, build, general)
  │
  ├── [route] → 条件边（conditional edge）跳转到特定意图的子 Agent
  │
  └── [run_{intent}] → 使用定制提示（tailored prompt）和工具的 ReAct Agent
        │
        ├── code_search / code_grep / code_context / 等
        │     │
        │     └── codebase-memory-mcp CLI (子进程)
        │
        └── LLM 生成答案
  │
  ▼
SSE 事件（SSE Events）:
  {"type": "session", "id": "uuid"}
  {"type": "token", "content": "chunk..."}
  {"type": "error", "message": "..."}    (失败时)
  {"type": "done"}                        (完成时)
  │
  ▼
前端 useSSE 钩子（hook）→ 实时渲染流式令牌（streaming tokens）
  │
  ▼
完成时：通过 POST /api/qa/save 自动保存问答对
```

### QA 条目生命周期（QA Entry Lifecycle）

```
User asks question
  │
  ▼ (pending)
QA Entry (status: pending, answer from LLM)
  │
  ▼ (calibrate)
Admin reviews → POST /api/qa/entry/{qid}/calibrate
  │
  ▼ (active)
QA Entry (status: active, gold-standard answer)
  │
  ├── 每次读取时增加访问计数（visit count）
  ├── 可归档（软删除）
  └── 领域分类（domain classification）可独立更新
```

### 关键源文件（Key source files）
- `backend/main.py` — `_qa_event_stream()`、`api_qa()` SSE 端点
- `backend/agent/graph.py` — `build_graph()`、意图分类与路由
- `backend/agent/agent.py` — `build_agent()`、ReAct 循环、系统提示（system prompt）
- `backend/agent/tools.py` — 12 个代码工具
- `backend/stores/qa.py` — QA 条目 CRUD、校准（calibration）
- `frontend/src/hooks/useSSE.ts` — SSE 流式钩子
- `frontend/src/pages/QAPage.tsx` — 问答界面

## 3. 主题 → Wiki 流水线（Topic → Wiki Pipeline）

```
Many QA entries on related topics
  │
  ▼ (aggregation)
Admin creates Topic → POST /api/topics {slug, name, description}
  │
  ▼ (link QA)
Admin links QA entries → stores/topics.link_qa()
  │
  ▼ (draft)
Auto-generate draft → POST /api/topics/{slug}/draft
  │ (raw content from aggregated QA)
  ▼ (edit)
Edit draft → PUT /api/topics/{slug}/draft {edited_content}
  │
  ▼ (approve)
Approve draft → stores/topics.approve_draft(slug, reviewer)
  │
  ▼ (publish)
Publish → POST /api/topics/{slug}/publish {wiki_module}
  │
  ▼
stores/topics.publish() → status='published'
stores/wiki.write_page() → writes .md to ~/.opencodewiki/pages/{entities,overviews,qa-archives}/
```

### 主题草稿生命周期（Topic Draft Lifecycle）

```
Topic (status: pool)
  │
  ├── save_draft() → status: pending (raw content)
  │
  ├── update_draft() → edited_content 字段更新
  │
  ├── approve_draft(reviewer) → status: approved
  │
  └── publish(wiki_module) → status: published + published_at
```

### 关键源文件（Key source files）
- `backend/stores/topics.py` — 主题 CRUD、草稿、发布
- `backend/stores/wiki.py` — wiki 页面文件操作
- `backend/main.py` — 主题 + wiki API 端点
- `frontend/src/pages/AdminPage.tsx` — 主题审核 + 发布界面
- `frontend/src/pages/WikiPage.tsx` — wiki 页面阅读器

## 4. 自动补全分析工作流（Autocomplete Analyze Workflow）

`POST /api/topics/analyze` 触发对未分组的 QA 条目进行自动聚类，生成主题建议（topic suggestions）。该端点分析待处理/活跃的 QA 条目，生成主题集群供管理员审核。

### 关键源文件（Key source files）
- `backend/main.py` — `api_analyze_topics()`
- `backend/stores/topics.py` — 主题存储函数

## 5. 全局搜索（Global Search）

`GET /api/search?q=...&limit=...` 同时在三个领域进行搜索：
- Wiki 页面（Markdown 文件内容）
- 主题（slug + name + description）
- QA 条目（问题文本）

结果按领域类型合并。

### 关键源文件（Key source files）
- `backend/main.py` — `api_search()`
- `backend/stores/topics.py` — `search_topics()`
- `backend/stores/qa.py` — `search_questions()`
- `backend/stores/wiki.py` — `list_pages()`（用于 wiki 搜索）
- `frontend/src/pages/HomePage.tsx` — 带自动补全的搜索界面

## 变更指南（Change Guidance）

修改任何工作流时，请验证：

1. **QA 生命周期完整性** — 变更是否保持了 pending → active/archived 的流程？
2. **主题→Wiki 流水线完整性** — pool → draft → approve → publish 链必须保持不中断
3. **源同步正确性** — 代码与文档的 git pull 与重新克隆行为是否正确
4. **SSE 流式传输** — 所有事件类型（session、token、error、done）必须发出
5. **状态一致性** — SQLite 中的 status 字段 CHECK 约束已强制执行