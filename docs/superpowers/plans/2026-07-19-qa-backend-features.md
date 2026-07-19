# QA 后端功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为三栏聊天 UI 提供后端数据支持：session 列表、参考引用、相关问题、topic 匹配、反馈持久化

**Architecture:** Python FastAPI + SQLite，分层为 database.py(建表) → stores/qa.py(CRUD) → main.py(端点) + agent/graph.py(解析 sources)

**Tech Stack:** Python 3.11, FastAPI, SQLite (sqlite3), LangGraph

## Global Constraints

- sources 从 Agent tool messages 解析，后端做
- topic 匹配基于已有 topics 列表，LLM 模糊匹配，无匹配 → `#general`
- topic 匹配替换现有 `classify_domain`，仅 session 创建时执行
- `#general` topic 不返回相关问题
- `qa_entries` 新增 `feedback TEXT` 和 `changes TEXT` 列
- 新增 `session_topics(session_id, topic_slug)` 表

---

### Task 1: database.py — schema 变更

**Files:**
- Modify: `backend/database.py`

**Produces:**
- `session_topics` 表
- `qa_entries.feedback` 列
- `qa_entries.changes` 列

- [ ] **Step 1: 在 _init_qa_db 末尾追加新表和列**

```python
# 在 _init_qa_db 的 db.executescript 末尾（calibrated_answers 之后）追加：

        CREATE TABLE IF NOT EXISTS session_topics (
            session_id  TEXT NOT NULL,
            topic_slug  TEXT NOT NULL,
            PRIMARY KEY (session_id, topic_slug)
        );
    """)

    # 新增列（migration-safe）
    for col, defn in [
        ("feedback", "TEXT DEFAULT NULL"),
        ("changes", "TEXT DEFAULT NULL"),
    ]:
        try:
            db.execute(f"ALTER TABLE qa_entries ADD COLUMN {col} {defn}")
        except Exception:
            pass  # column already exists
```

- [ ] **Step 2: 验证 schema**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "
from database import get_qa_db
db = get_qa_db()
cols = [c[1] for c in db.execute('PRAGMA table_info(qa_entries)').fetchall()]
print('feedback' in cols, 'changes' in cols)
print(db.execute('SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"session_topics\"').fetchone())
"
```

预期输出: `True True ('session_topics',)`

- [ ] **Step 3: Commit**

```bash
git add backend/database.py
git commit -m "feat: schema — session_topics 表 + qa_entries.feedback/changes 列

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: stores/qa.py — 5 个新函数

**Files:**
- Modify: `backend/stores/qa.py`

**Interfaces:**
- Produces:
  - `list_sessions() -> list[dict]` — 所有 session 摘要
  - `get_sources(qid: int) -> list[dict]` — 条目的参考引用
  - `get_related(qid: int) -> list[dict]` — 同 topic 相关问题
  - `save_feedback(qid: int, fb: str) -> bool` — 保存反馈
  - `match_topic(session_id: str, question: str, answer: str) -> str` — LLM 匹配 topic

- [ ] **Step 1: 在文件末尾追加 list_sessions**

```python
def list_sessions() -> list[dict]:
    """返回所有 session 摘要，按时间倒序。"""
    db = get_qa_db()
    rows = db.execute(
        "SELECT session_id, question AS root_question, created_at, "
        "(SELECT COUNT(*) FROM qa_entries e2 WHERE e2.session_id = qa_entries.session_id) AS message_count "
        "FROM qa_entries "
        "WHERE session_id != '' "
        "GROUP BY session_id "
        "ORDER BY MIN(created_at) DESC"
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: 追加 get_sources**

```python
def get_sources(qid: int) -> list[dict]:
    """返回某个 QA 条目的参考引用来源。"""
    db = get_qa_db()
    row = db.execute("SELECT sources FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not row:
        return []
    return _parse_json(row["sources"])
```

- [ ] **Step 3: 追加 get_related**

```python
def get_related(qid: int, limit: int = 5) -> list[dict]:
    """返回同 topic 的其他 QA 问题（排除 #general）。"""
    db = get_qa_db()
    entry = db.execute("SELECT session_id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return []
    sid = entry["session_id"]

    rows = db.execute(
        "SELECT DISTINCT e.qid, e.question, e.status, e.created_at "
        "FROM qa_entries e "
        "JOIN session_topics st ON st.session_id = e.session_id "
        "WHERE st.topic_slug IN ("
        "  SELECT topic_slug FROM session_topics WHERE session_id = ? AND topic_slug != 'general'"
        ") AND e.session_id != ? "
        "AND e.session_id != '' "
        "AND e.qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = e.session_id) "
        "ORDER BY e.created_at DESC "
        "LIMIT ?",
        (sid, sid, limit),
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: 追加 save_feedback**

```python
def save_feedback(qid: int, fb: str) -> bool:
    """保存用户反馈。"""
    if fb not in ("accepted", "rejected"):
        return False
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET feedback = ? WHERE qid = ?", (fb, qid))
    db.commit()
    return db.total_changes > 0
```

- [ ] **Step 5: 追加 match_topic**

```python
def match_topic(session_id: str, question: str, answer: str):
    """LLM 匹配 topic，写入 session_topics。从 knowledge.db 获取已有 topics 列表。"""
    from database import get_knowledge_db
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    kdb = get_knowledge_db()
    topics = kdb.execute("SELECT slug, name FROM topics").fetchall()
    if not topics:
        return

    topic_list = "\n".join(f"- {t['slug']}: {t['name']}" for t in topics)
    llm = build_llm(get_llm_config())
    prompt = (
        f"问题：{question}\n回答：{answer[:500]}\n\n"
        f"已有主题列表：\n{topic_list}\n\n"
        f"从列表中选择最匹配的主题 slug。如果没有匹配的，输出 general。只输出 slug 名称。"
    )
    resp = llm.invoke(prompt)
    slug = resp.content.strip().lower()
    if slug not in {t["slug"] for t in topics}:
        slug = "general"

    db = get_qa_db()
    db.execute(
        "INSERT OR IGNORE INTO session_topics (session_id, topic_slug) VALUES (?, ?)",
        (session_id, slug),
    )
    db.commit()
```

- [ ] **Step 6: 验证 import**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from stores.qa import list_sessions, get_sources, get_related, save_feedback, match_topic; print('imports OK')"
```

- [ ] **Step 7: Commit**

```bash
git add backend/stores/qa.py
git commit -m "feat: stores/qa.py — list_sessions/get_sources/get_related/save_feedback/match_topic

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: agent/graph.py — parse sources from tool messages

**Files:**
- Modify: `backend/agent/graph.py`

**Interfaces:**
- Consumes: `run_sub` returns `{"messages": [...], "sources": [...]}`
- Produces: `_qa_event_stream` in main.py reads `result.get("sources")`

- [ ] **Step 1: 在 run_sub 中解析 tool 调用结果**

在 `run_sub` 的 `final = await agent.ainvoke(...)` 之后，添加 sources 解析：

```python
# 在 agent/agent/tools.py 确认工具返回格式后，解析 tool messages
# 当前所有 CODEGRAPH_TOOLS 返回的结构中包含文件路径信息

# Parse sources from tool messages
sources = []
for m in all_msgs:
    role = getattr(m, "type", "")
    if role == "tool":
        content = getattr(m, "content", "") or ""
        name = getattr(m, "name", "")
        # code_search / code_context / code_grep 的结果包含文件路径
        if name in ("code_search", "code_context", "code_grep", "code_files", "code_read_wiki"):
            try:
                data = json.loads(content) if isinstance(content, str) else content
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "file" in item:
                            sources.append({
                                "file": item.get("file", ""),
                                "line": item.get("line", ""),
                                "snippet": str(item.get("snippet", item.get("content", "")))[:300],
                            })
                elif isinstance(data, dict) and "file" in data:
                    sources.append({
                        "file": data.get("file", ""),
                        "line": data.get("line", ""),
                        "snippet": str(data.get("snippet", data.get("content", "")))[:300],
                    })
            except (json.JSONDecodeError, TypeError):
                pass

# 去重
seen = set()
unique_sources = []
for s in sources:
    key = (s["file"], s["line"])
    if key not in seen:
        seen.add(key)
        unique_sources.append(s)

return {"messages": all_msgs, "sources": unique_sources}
```

- [ ] **Step 2: 更新 main.py 中 _qa_event_stream 消费 sources**

```python
# 在 _qa_event_stream 中，result 现在包含 sources
sources = result.get("sources", [])
if sources:
    yield _sse("sources", {"sources": sources})
```

- [ ] **Step 3: 验证后端启动**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from agent.graph import get_graph; g = get_graph(); print('graph OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/agent/graph.py backend/main.py
git commit -m "feat: graph.py — run_sub 从 tool messages 解析 sources + SSE emit

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: main.py — 4 个新端点 + 2 个已有端点修改

**Files:**
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `list_sessions`, `get_sources`, `get_related`, `save_feedback`, `match_topic` from stores/qa.py
- Produces: 4 new routes, 2 modified routes

- [ ] **Step 1: 新增 GET /api/sessions**

```python
@app.get("/api/sessions")
async def api_sessions():
    from stores.qa import list_sessions
    return _ok({"sessions": list_sessions()})
```

- [ ] **Step 2: 新增 GET /api/qa/entry/{qid}/sources**

```python
@app.get("/api/qa/entry/{qid}/sources")
async def api_qa_sources(qid: int):
    from stores.qa import get_sources
    sources = get_sources(qid)
    return _ok({"sources": sources})
```

- [ ] **Step 3: 新增 GET /api/qa/entry/{qid}/related**

```python
@app.get("/api/qa/entry/{qid}/related")
async def api_qa_related(qid: int):
    from stores.qa import get_related
    return _ok({"related": get_related(qid)})
```

- [ ] **Step 4: 新增 POST /api/qa/entry/{qid}/feedback**

```python
@app.post("/api/qa/entry/{qid}/feedback")
async def api_qa_feedback(qid: int, body: dict):
    fb = (body.get("feedback") or "").strip()
    if fb not in ("accepted", "rejected"):
        return _err("feedback must be 'accepted' or 'rejected'")
    from stores.qa import save_feedback
    ok = save_feedback(qid, fb)
    if not ok:
        raise HTTPException(404, f"#Q{qid} not found")
    return _ok({"qid": qid, "feedback": fb})
```

- [ ] **Step 5: 修改 POST /api/qa/save — 加入 session_create 触发 topic 匹配**

```python
@app.post("/api/qa/save")
async def api_qa_save(body: dict):
    question = body.get("question", "").strip()
    answer = body.get("answer", "").strip()
    if not question:
        return _err("Missing question or answer")
    session_id = body.get("session_id") or ""
    sources = body.get("sources", [])
    session_create = body.get("session_create", False)

    entry = create_entry({
        "question": question,
        "answer": answer,
        "repo": body.get("repo", ""),
        "session_id": session_id,
        "mode": body.get("mode", "deep"),
        "sources": sources,
    })

    # Topic matching — only on session creation
    if session_create and session_id:
        from stores.qa import match_topic
        match_topic(session_id, question, answer)

    return _ok({"qid": entry["qid"], "id": entry["id"], "session_id": entry["session_id"]})
```

- [ ] **Step 6: 修改 _qa_event_stream — 在 done 前 emit sources**

```python
# 在 _qa_event_stream 的 final_answer 发射之后、yield _sse("done", {}) 之前：
sources = result.get("sources", [])
if sources:
    yield _sse("sources", {"sources": sources})
```

- [ ] **Step 7: 验证所有新端点**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from main import app; print('routes OK:', len(app.routes))"
```

- [ ] **Step 8: Commit**

```bash
git add backend/main.py
git commit -m "feat: main.py — 4 新端点 + save 改 topic 匹配 + SSE sources 事件

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Stores 测试

**Files:**
- Create/Modify: `backend/tests/test_stores/test_qa.py`

- [ ] **Step 1: 追加测试用例到现有 test_qa.py**

```python
def test_list_sessions():
    from stores.qa import list_sessions, create_entry
    sid = "test-sess-" + str(uuid.uuid4())[:8]
    create_entry({"question": "root", "answer": "a", "session_id": sid})
    create_entry({"question": "followup", "answer": "b", "session_id": sid})
    sessions = list_sessions()
    assert any(s["session_id"] == sid for s in sessions)
    s = next(s for s in sessions if s["session_id"] == sid)
    assert s["message_count"] >= 2

def test_save_feedback():
    from stores.qa import save_feedback, create_entry, get_entry
    entry = create_entry({"question": "feedback test", "answer": "x", "session_id": "fb-test"})
    assert save_feedback(entry["qid"], "accepted") is True
    e = get_entry(entry["qid"])
    assert e["feedback"] == "accepted"
    assert save_feedback(99999, "accepted") is False

def test_save_feedback_invalid():
    from stores.qa import save_feedback
    assert save_feedback(1, "invalid") is False

def test_get_sources():
    from stores.qa import get_sources, create_entry
    entry = create_entry({
        "question": "sources test", "answer": "x",
        "session_id": "src-test",
        "sources": [{"file": "f.py", "line": "L10", "snippet": "code"}]
    })
    sources = get_sources(entry["qid"])
    assert len(sources) == 1
    assert sources[0]["file"] == "f.py"
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -m pytest tests/test_stores/test_qa.py -v
```

Expected: new tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_stores/test_qa.py
git commit -m "test: stores/qa.py — list_sessions/save_feedback/get_sources 测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 端点集成测试 + 全量回归

**Files:**
- Run: `backend/tests/`

- [ ] **Step 1: 运行全量后端测试**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -m pytest -v 2>&1 | tail -20
```

Expected: all existing tests pass, new tests pass

- [ ] **Step 2: 手动 verify 新端点**

```bash
# 启动后端后测试:
curl http://localhost:8100/api/sessions | jq '.ok'
curl http://localhost:8100/api/qa/entry/10029/sources | jq '.ok'
curl http://localhost:8100/api/qa/entry/10029/related | jq '.ok'
curl -X POST http://localhost:8100/api/qa/entry/10029/feedback -H 'Content-Type: application/json' -d '{"feedback":"accepted"}' | jq '.ok'
```

- [ ] **Step 3: Commit (if any fixes)**

```bash
git add -A && git commit -m "test: 全量回归 + 新端点集成测试"
```

---

## 文件变更汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/database.py` | 修改 | +session_topics 表 + 2 列 |
| `backend/stores/qa.py` | 修改 | +5 函数 |
| `backend/agent/graph.py` | 修改 | sources 解析 |
| `backend/main.py` | 修改 | 4 新端点 + 2 改旧端点 |
| `backend/tests/test_stores/test_qa.py` | 修改 | +4 测试 |
