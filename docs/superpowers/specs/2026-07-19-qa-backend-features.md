# QA 后端功能实现设计

## 概述

为三栏聊天 UI 提供后端数据支持。6 个功能点：session 列表、参考引用、相关问题、关联主题匹配、反馈持久化、关联变更。

## 数据流

```
用户提问
→ Agent 搜索知识库 → sources = [{file, line, snippet}]
→ SSE: token... + sources 事件
→ 前端收集 answer + sources
→ POST /api/qa/save {question, answer, sources, session_id}
→ 后端: LLM 匹配已有 topic → 写入 session_topics
→ 右栏 GET /api/qa/entry/{qid}/sources → 渲染参考引用
→ 左栏 GET /api/qa/entry/{qid}/related → 渲染相关问题
→ 左栏 GET /api/sessions → 渲染历史对话
```

## 数据模型变更

### session_topics 表（新增）

```sql
CREATE TABLE IF NOT EXISTS session_topics (
    session_id  TEXT NOT NULL,
    topic_slug  TEXT NOT NULL,
    PRIMARY KEY (session_id, topic_slug)
);
```

### qa_entries 表字段（新增）

- `changes TEXT DEFAULT NULL` — JSON 数组，关联变更内容

### feedback 持久化

`qa_entries` 表新增列 `feedback TEXT DEFAULT NULL` — `accepted | rejected | null`

不复用 `status` 字段（`status` 用于 QA 生命周期：pending → active → archived，feedback 是正交概念）。

## API 设计

### 1. POST /api/qa/save（修改）

**新增参数:**
- `sources` — `[{file, line, snippet}]`，Agent 搜索的代码上下文

**新增逻辑:**
- 保存后 LLM 自动匹配已有 topic → 写入 `session_topics`

### 2. GET /api/sessions（新增）

**返回:** 所有 session 摘要列表

```json
{
  "sessions": [
    {
      "session_id": "uuid",
      "root_question": "...",
      "created_at": "...",
      "message_count": 3
    }
  ]
}
```

**SQL:** `SELECT session_id, question, created_at FROM qa_entries WHERE session_id != '' GROUP BY session_id ORDER BY created_at DESC`

### 3. GET /api/qa/entry/{qid}/sources（新增）

**返回:** 该 QA 条目的参考引用来源

```json
{
  "sources": [
    {"file": "docs/02-qa-engine.md", "line": "L14-L15", "snippet": "..."}
  ]
}
```

**实现:** 从 `qa_entries.sources` JSON 字段读取。

### 4. GET /api/qa/entry/{qid}/related（新增）

**返回:** 同 topic 下的其他 QA 问题

```json
{
  "related": [
    {"qid": 123, "question": "...", "status": "active"}
  ]
}
```

**实现:** 通过 `session_topics` 找到当前 session 的 topics → 查同 topic 的其他 session 的根问题。

### 5. POST /api/qa/entry/{qid}/feedback（新增）

**请求:** `{ feedback: "accepted" | "rejected" }`

**实现:** 更新 `qa_entries.feedback` 字段。

### 6. SSE 流 — sources 事件（修改）

`_qa_event_stream` 在 Agent 完成后、token 发射前 emit sources:

```python
yield _sse("sources", {"sources": sources})
```

## 需要修改的文件

| 文件 | 改动 |
|------|------|
| `backend/database.py` | 新增 `session_topics` 表 |
| `backend/stores/qa.py` | 新增 `list_sessions`, `get_sources`, `get_related`, `save_feedback`, `match_topic` |
| `backend/main.py` | 4 个新端点 + 2 个修改已有端点 |
| `backend/agent/graph.py` | `run_sub` 返回 sources |
| `backend/agent/tools.py` | 工具返回标准化的 sources 结构 |

## 不在此 scope

- 关联变更从回答中解析（功能模糊，先预留字段）
- 前端对接（后续执行阶段）
