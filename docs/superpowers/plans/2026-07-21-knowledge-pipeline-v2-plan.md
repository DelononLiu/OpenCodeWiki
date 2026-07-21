# 知识沉淀 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将知识沉淀 AdminPage 从三 tab 空壳改造为四阶段半自动知识管线（QA 校准 → Topic 发现 → Draft 提炼 → Wiki 审核），并补上 RAG 增强 + 反馈修正的自进化闭环。

**Architecture:** 后端新增 6 个 API 端点，stores 层新增 LLM 调用逻辑（analyze/generate），SQLite 新增 FTS5 wiki_index 表。前端 AdminPage 重写为管线容器，拆出 4 个阶段卡片组件 + 2 个共享组件。

**Tech Stack:** Python FastAPI + LangChain (LLM calls) + SQLite FTS5 + React 18 + TypeScript + Tailwind CSS + shadcn/ui + lucide-react

**Spec:** `docs/superpowers/specs/2026-07-21-knowledge-pipeline-v2-design.md`

## Global Constraints

- SQLite FTS5 must be enabled at compile time (standard in Python 3.11+ sqlite3)
- All LLM calls use existing `config.get_llm_config()` + `agent.agent._build_llm()` pattern
- Frontend follows existing shadcn/ui + Tailwind patterns, no new UI libraries
- API responses use existing `_ok(data)` / `_err(msg, status)` helpers
- Draft template: `## 概述\n## 常见场景\n## 解决方案\n## 注意事项`
- topic_drafts.status extended to: `pending | submitted | approved | rejected`

---

### Task 1: Database Migration — topic_drafts columns + wiki_index FTS5

**Files:**
- Modify: `backend/database.py:162-181`

**Interfaces:**
- Produces: `topic_drafts` table with `reject_reason TEXT`, `generated_at TEXT`, status CHECK includes `submitted`
- Produces: `wiki_index` FTS5 virtual table in qa.db with columns `(slug, chunk_text, keywords, published_at)`

- [ ] **Step 1: Update topic_drafts CHECK constraint and add new columns in `_init_knowledge_db`**

Replace lines 163-173 in `backend/database.py`:

```python
        CREATE TABLE IF NOT EXISTS topic_drafts (
            topic_slug    TEXT PRIMARY KEY REFERENCES topics(slug),
            raw_content   TEXT NOT NULL,
            edited_content TEXT DEFAULT NULL,
            status        TEXT DEFAULT 'pending'
                          CHECK(status IN ('pending','submitted','approved','rejected')),
            reviewer      TEXT DEFAULT '',
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now')),
            reviewed_at   TEXT DEFAULT NULL,
            reject_reason TEXT DEFAULT NULL,
            generated_at  TEXT DEFAULT NULL
        );
```

- [ ] **Step 2: Add migration-safe column additions for existing databases**

Replace lines 176-180 in `backend/database.py`:

```python
    # Migration: add columns to topic_drafts if missing
    for col, defn in [
        ("updated_at", "TEXT DEFAULT (datetime('now'))"),
        ("reject_reason", "TEXT DEFAULT NULL"),
        ("generated_at", "TEXT DEFAULT NULL"),
    ]:
        try:
            db.execute(f"ALTER TABLE topic_drafts ADD COLUMN {col} {defn}")
        except Exception:
            pass
```

- [ ] **Step 3: Add wiki_index FTS5 table to `_init_qa_db`**

Add after the `session_topics` CREATE TABLE block (after line 84 in `_init_qa_db`):

```python
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_index USING fts5(
            slug,
            chunk_text,
            keywords,
            published_at,
            content='',
            content_rowid='rowid'
        );
```

- [ ] **Step 4: Run backend import to verify migration**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from database import init_databases; init_databases(); print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Verify FTS5 table exists**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "
from database import get_qa_db, init_databases
init_databases()
db = get_qa_db()
r = db.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_index'\").fetchone()
print('FTS5 wiki_index exists:', r is not None)
"
```

Expected: `FTS5 wiki_index exists: True`

- [ ] **Step 6: Commit**

```bash
git add backend/database.py
git commit -m "feat(db): add topic_drafts review columns and wiki_index FTS5 table

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Topics Store — LLM analyze + generate + review queue

**Files:**
- Modify: `backend/stores/topics.py`

**Interfaces:**
- Consumes: `database.get_knowledge_db()`, `database.get_qa_db()`, `config.get_llm_config()`, `agent.agent._build_llm()`
- Produces:
  - `analyze_qa_pool() -> dict` — returns `{suggestions: list, matched: list, total_new: int}`
  - `generate_draft_for_topic(slug: str) -> dict` — returns draft dict
  - `submit_draft(slug: str) -> bool`
  - `approve_draft(slug: str, wiki_module: str) -> bool`
  - `reject_draft(slug: str, reason: str) -> bool`
  - `get_review_queue() -> list[dict]`

- [ ] **Step 1: Add imports and `analyze_qa_pool()` function**

Append to `backend/stores/topics.py`:

```python
import json
from datetime import datetime, timezone


def analyze_qa_pool() -> dict:
    """LLM 扫描全量 active QA，按语义聚类建议 topic。"""
    from database import get_qa_db, get_knowledge_db
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    qa_db = get_qa_db()
    kdb = get_knowledge_db()

    # 获取所有 active QA
    rows = qa_db.execute(
        "SELECT qid, question, answer, domain FROM qa_entries WHERE status = 'active' ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    if not rows:
        return {"suggestions": [], "matched": [], "total_new": 0}

    # 获取已有 topics
    existing = kdb.execute("SELECT slug, name FROM topics").fetchall()
    existing_list = [dict(r) for r in existing]

    # 构建 prompt
    qa_list = "\n".join(
        f"Q{q['qid']}: {q['question'][:100]} | domain={q['domain']}"
        for q in rows
    )
    existing_str = "\n".join(
        f"- {t['slug']}: {t['name']}" for t in existing_list
    ) if existing_list else "(暂无已有主题)"

    llm = build_llm(get_llm_config())
    prompt = (
        f"你是一个知识管理助手。请分析以下 QA 条目，按语义将它们聚类为主题(Topic)。\n\n"
        f"## 已有主题\n{existing_str}\n\n"
        f"## 待分析的 QA\n{qa_list}\n\n"
        f"## 任务\n"
        f"1. 将语义相关的 QA 分组，每组生成一个 topic\n"
        f"2. 如果某组 QA 已有对应主题，直接关联到已有主题\n"
        f"3. 如果某条 QA 无法归类，忽略它\n\n"
        f"输出 JSON 数组，每个元素格式：\n"
        f'{{"slug": "topic-slug", "name": "主题名称", "description": "一句话描述", '
        f'"qa_ids": [1,2,3], "is_new": true/false}}\n\n'
        f"只输出 JSON 数组，不要其他内容。"
    )

    try:
        resp = llm.invoke(prompt)
        content = resp.content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:]) if lines[0].startswith("```") else content
            if content.endswith("```"):
                content = content[:-3]
        suggestions = json.loads(content)
    except Exception:
        return {"suggestions": [], "matched": [], "total_new": 0, "error": "LLM 分析失败"}

    new_count = 0
    matched_list = []
    new_list = []

    for item in suggestions:
        slug = item.get("slug", "").strip()
        name = item.get("name", "").strip()
        qa_ids = item.get("qa_ids", [])
        is_new = item.get("is_new", True)

        if not slug or not qa_ids:
            continue

        if is_new:
            create_topic(slug, name, item.get("description", ""))
            for qid in qa_ids:
                link_qa(slug, qid)
            new_list.append(item)
            new_count += 1
        else:
            for qid in qa_ids:
                link_qa(slug, qid)
            matched_list.append(item)

    return {
        "suggestions": new_list,
        "matched": matched_list,
        "total_new": new_count,
    }
```

- [ ] **Step 2: Add `generate_draft_for_topic()` function**

Append to `backend/stores/topics.py`:

```python
DRAFT_TEMPLATE = """## 概述
{overview}

## 常见场景
{scenarios}

## 解决方案
{solutions}

## 注意事项
{notes}"""


def generate_draft_for_topic(slug: str) -> dict | None:
    """LLM 按模板总结 topic 下所有 QA，生成结构化 Draft。"""
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    topic = get_topic(slug)
    if not topic:
        return None

    qa_entries = topic.get("qa_entries", [])
    if not qa_entries:
        return None

    qa_text = "\n\n---\n\n".join(
        f"Q: {qa['question']}\nA: {(qa.get('answer') or '')[:500]}"
        for qa in qa_entries
    )

    llm = build_llm(get_llm_config())
    prompt = (
        f"你是一个技术文档撰写助手。请根据以下 QA 问答对，总结一份结构化的知识文档。\n\n"
        f"## 主题: {topic['name']}\n"
        f"## 描述: {topic.get('description', '')}\n\n"
        f"## QA 内容\n{qa_text}\n\n"
        f"## 输出格式\n"
        f"请严格按照以下 Markdown 模板输出：\n"
        f"## 概述\n(1-2句话概括这类问题的本质)\n\n"
        f"## 常见场景\n- 场景1\n- 场景2\n\n"
        f"## 解决方案\n(汇总核心解决思路和步骤)\n\n"
        f"## 注意事项\n- 注意点1\n- 注意点2\n\n"
        f"只输出按模板组织的 Markdown 文档，不要其他内容。"
    )

    try:
        resp = llm.invoke(prompt)
        raw_content = resp.content.strip()
    except Exception:
        return None

    save_draft(slug, raw_content)
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET generated_at = ? WHERE topic_slug = ?",
        (now, slug),
    )
    db.commit()

    return get_draft(slug)
```

- [ ] **Step 3: Add `submit_draft()`, `approve_draft()`, `reject_draft()`, `get_review_queue()`**

Append to `backend/stores/topics.py`:

```python
def submit_draft(slug: str) -> bool:
    """将 draft 提交到审核队列 (pending → submitted)。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status FROM topic_drafts WHERE topic_slug = ?", (slug,)
    ).fetchone()
    if not row or row["status"] != "pending":
        return False
    db.execute(
        "UPDATE topic_drafts SET status = 'submitted', updated_at = ? WHERE topic_slug = ?",
        (datetime.now(timezone.utc).isoformat(), slug),
    )
    db.commit()
    return True


def approve_draft(slug: str, wiki_module: str) -> bool:
    """审核通过：写 Wiki 文件 + 索引到 FTS5 + 发布 topic。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status, edited_content, raw_content FROM topic_drafts WHERE topic_slug = ?",
        (slug,),
    ).fetchone()
    if not row or row["status"] != "submitted":
        return False

    content = row["edited_content"] or row["raw_content"]

    # 写入 Wiki 文件
    from stores.wiki import write_page, index_wiki_page
    write_page(slug, "entity", content)

    # 索引到 FTS5
    index_wiki_page(slug, content)

    # 更新 draft 状态
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'approved', reviewed_at = ? WHERE topic_slug = ?",
        (now, slug),
    )
    db.commit()

    # 发布 topic
    publish(slug, wiki_module)
    return True


def reject_draft(slug: str, reason: str) -> bool:
    """审核驳回：submitted → pending，附带驳回理由。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status FROM topic_drafts WHERE topic_slug = ?", (slug,)
    ).fetchone()
    if not row or row["status"] != "submitted":
        return False
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'pending', reject_reason = ?, updated_at = ? WHERE topic_slug = ?",
        (reason, now, slug),
    )
    db.commit()
    return True


def get_review_queue() -> list[dict]:
    """获取所有 status='submitted' 的 draft + 关联 topic 信息。"""
    db = get_knowledge_db()
    rows = db.execute(
        """SELECT d.topic_slug, d.raw_content, d.edited_content, d.status,
                  d.created_at, d.updated_at, d.generated_at,
                  t.name as topic_name, t.description as topic_description
           FROM topic_drafts d
           JOIN topics t ON t.slug = d.topic_slug
           WHERE d.status = 'submitted'
           ORDER BY d.updated_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Verify imports work**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from stores.topics import analyze_qa_pool, generate_draft_for_topic, submit_draft, approve_draft, reject_draft, get_review_queue; print('Imports OK')"
```

- [ ] **Step 5: Commit**

```bash
git add backend/stores/topics.py
git commit -m "feat(topics): add analyze, generate_draft, review queue functions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Wiki Store — FTS5 index and search

**Files:**
- Modify: `backend/stores/wiki.py`

**Interfaces:**
- Produces: `index_wiki_page(slug: str, content: str) -> None`
- Produces: `search_wiki_index(query: str, limit: int = 3) -> list[dict]`

- [ ] **Step 1: Add `index_wiki_page` and `search_wiki_index` functions**

Append to `backend/stores/wiki.py`:

```python
import re
from datetime import datetime, timezone


def index_wiki_page(slug: str, content: str) -> None:
    """将 Wiki 页面分块写入 FTS5 wiki_index 表。"""
    from database import get_qa_db

    db = get_qa_db()

    # 删除旧索引
    db.execute("DELETE FROM wiki_index WHERE slug = ?", (slug,))

    # 按段落分块（以 ## 为界）
    chunks = re.split(r"\n(?=## )", content)
    now = datetime.now(timezone.utc).isoformat()

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk or len(chunk) < 20:
            continue
        # 提取关键词（标题行 + 去停用词的前 10 个词）
        first_line = chunk.split("\n")[0].lstrip("# ").strip()
        keywords = first_line
        db.execute(
            "INSERT INTO wiki_index (slug, chunk_text, keywords, published_at) VALUES (?, ?, ?, ?)",
            (slug, chunk, keywords, now),
        )
    db.commit()


def search_wiki_index(query: str, limit: int = 3) -> list[dict]:
    """FTS5 搜索 wiki_index，返回匹配的 chunk。"""
    from database import get_qa_db

    db = get_qa_db()
    try:
        rows = db.execute(
            "SELECT slug, chunk_text, keywords, rank FROM wiki_index WHERE wiki_index MATCH ? ORDER BY rank LIMIT ?",
            (query, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
```

- [ ] **Step 2: Verify imports**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "from stores.wiki import index_wiki_page, search_wiki_index; print('Imports OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/stores/wiki.py
git commit -m "feat(wiki): add FTS5 index_wiki_page and search_wiki_index

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: API Endpoints — 6 new routes in main.py

**Files:**
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `stores.topics.analyze_qa_pool`, `generate_draft_for_topic`, `submit_draft`, `approve_draft`, `reject_draft`, `get_review_queue`
- Consumes: `stores.wiki.search_wiki_index`
- Produces:
  - `POST /api/topics/analyze`
  - `POST /api/topics/{slug}/generate`
  - `POST /api/topics/{slug}/submit`
  - `POST /api/topics/{slug}/approve`
  - `POST /api/topics/{slug}/reject`
  - `GET /api/wiki/review-queue`
  - `GET /api/wiki/search-index`

- [ ] **Step 1: Add new API routes**

Insert after the `publish_topic` endpoint block (after line 837 in `backend/main.py`, before the `except ImportError: pass` line):

```python
    @app.post("/api/topics/analyze")
    async def api_analyze_topics_v2():
        """LLM 批量分析 QA 池，按语义聚类建议 topic。"""
        from stores.topics import analyze_qa_pool
        try:
            result = analyze_qa_pool()
            return _ok(result)
        except Exception as e:
            return _err(str(e), 500)

    @app.post("/api/topics/{slug}/generate")
    async def api_generate_draft(slug: str):
        """LLM 按模板生成 topic 的 Draft 文档。"""
        from stores.topics import generate_draft_for_topic
        result = generate_draft_for_topic(slug)
        if not result:
            return _err("Topic not found or has no QA entries", 404)
        return _ok(result)

    @app.post("/api/topics/{slug}/submit")
    async def api_submit_draft(slug: str):
        """提交 draft 到审核队列 (pending → submitted)。"""
        from stores.topics import submit_draft
        ok = submit_draft(slug)
        if not ok:
            return _err("Draft not found or status is not pending", 400)
        return _ok({"submitted": True})

    @app.post("/api/topics/{slug}/approve")
    async def api_approve_draft(slug: str, body: dict):
        """审核通过 draft，写入 Wiki + 索引 FTS5。"""
        wiki_module = body.get("wiki_module", "").strip()
        if not wiki_module:
            return _err("Missing wiki_module")
        from stores.topics import approve_draft
        ok = approve_draft(slug, wiki_module)
        if not ok:
            return _err("Draft not found or status is not submitted", 400)
        return _ok({"published": True, "slug": slug})

    @app.post("/api/topics/{slug}/reject")
    async def api_reject_draft(slug: str, body: dict):
        """驳回 draft 回到 pending 状态。"""
        reason = body.get("reason", "").strip()
        from stores.topics import reject_draft
        ok = reject_draft(slug, reason)
        if not ok:
            return _err("Draft not found or status is not submitted", 400)
        return _ok({"rejected": True})

    @app.get("/api/wiki/review-queue")
    async def api_review_queue():
        """获取待审核 draft 队列。"""
        from stores.topics import get_review_queue
        return _ok({"queue": get_review_queue()})

    @app.get("/api/wiki/search-index")
    async def api_search_wiki_index(q: str = "", limit: int = 5):
        """搜索 wiki_index FTS5。"""
        from stores.wiki import search_wiki_index
        if len(q.strip()) < 2:
            return _ok({"results": []})
        return _ok({"results": search_wiki_index(q, limit)})
```

- [ ] **Step 2: Add wiki_index search injection to QA flow**

In the `_qa_event_stream` function, add wiki search after question is received. Find `_qa_event_stream` (line 512 in `backend/main.py`), insert before the `graph.ainvoke` call (around line 540):

```python
    # Search wiki_index for relevant knowledge
    wiki_context = ""
    try:
        from stores.wiki import search_wiki_index
        wiki_results = search_wiki_index(question, limit=3)
        if wiki_results:
            wiki_chunks = "\n---\n".join(
                f"来源: {r['slug']}\n{r['chunk_text'][:500]}"
                for r in wiki_results
            )
            wiki_context = f"\n\n[知识库相关沉淀]\n{wiki_chunks}\n"
    except Exception:
        pass

    final_answer = ""
    try:
        result = await asyncio.wait_for(
            graph.ainvoke(
                {"question": augmented_question + wiki_context, "project": repo, "intent": "", "messages": prior_messages},
                config={"configurable": {"thread_id": session_id}},
            ),
            timeout=120,
        )
```

- [ ] **Step 3: Verify server starts**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && timeout 5 python -c "
from main import app
print('App loaded OK, routes:', len(app.routes))
" 2>&1 || true
```

Expected: prints route count without import errors.

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(api): add 6 knowledge pipeline endpoints + wiki search injection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Frontend Types — new interfaces

**Files:**
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Produces: `TopicSuggestion`, `ReviewItem`, `PipelineCounts`

- [ ] **Step 1: Add new types**

Append to `frontend/src/types/index.ts`:

```ts
export interface TopicSuggestion {
  slug: string
  name: string
  description: string
  qa_ids: number[]
  is_new: boolean
}

export interface AnalyzeResult {
  suggestions: TopicSuggestion[]
  matched: TopicSuggestion[]
  total_new: number
  error?: string
}

export interface ReviewItem {
  topic_slug: string
  topic_name: string
  topic_description: string
  raw_content: string
  edited_content: string | null
  status: string
  created_at: string
  updated_at: string
  generated_at: string | null
}

export interface PipelineCounts {
  qaPending: number
  unclassified: number
  topicDraft: number
  reviewQueue: number
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add TopicSuggestion, ReviewItem, PipelineCounts interfaces

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Frontend API Client — new functions

**Files:**
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces: `analyzeTopics()`, `generateDraft()`, `submitDraft()`, `approveDraft()`, `rejectDraft()`, `fetchReviewQueue()`

- [ ] **Step 1: Add new API functions**

Append to `frontend/src/api/client.ts` (before the last line):

```ts
// ── Knowledge Pipeline ──

export function analyzeTopics(): Promise<AnalyzeResult> {
  return request<AnalyzeResult>('/topics/analyze', { method: 'POST' })
}

export function generateDraft(slug: string): Promise<TopicDraft> {
  return request<TopicDraft>(`/topics/${encodeURIComponent(slug)}/generate`, { method: 'POST' })
}

export function submitDraft(slug: string): Promise<{ submitted: boolean }> {
  return request<{ submitted: boolean }>(`/topics/${encodeURIComponent(slug)}/submit`, { method: 'POST' })
}

export function approveDraft(slug: string, wikiModule: string): Promise<{ published: boolean; slug: string }> {
  return request<{ published: boolean; slug: string }>(`/topics/${encodeURIComponent(slug)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}

export function rejectDraft(slug: string, reason: string): Promise<{ rejected: boolean }> {
  return request<{ rejected: boolean }>(`/topics/${encodeURIComponent(slug)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function fetchReviewQueue(): Promise<{ queue: ReviewItem[] }> {
  return request<{ queue: ReviewItem[] }>('/wiki/review-queue')
}
```

Add the import at the top of the file (after existing imports):

```ts
import type { AnalyzeResult, ReviewItem } from '@/types'
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(api-client): add knowledge pipeline API functions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: PipelineProgress — shared progress bar component

**Files:**
- Create: `frontend/src/components/knowledge/PipelineProgress.tsx`

**Interfaces:**
- Consumes: `PipelineCounts` from types
- Produces: `<PipelineProgress>` component

- [ ] **Step 1: Create component**

Write `frontend/src/components/knowledge/PipelineProgress.tsx`:

```tsx
import type { PipelineCounts } from '@/types'

interface PipelineProgressProps {
  counts: PipelineCounts
  activeStage: number | null
  onStageClick: (stage: number) => void
}

const STAGES = [
  { num: 1, label: 'QA 校准', countKey: 'qaPending' as const },
  { num: 2, label: 'Topic 发现', countKey: 'unclassified' as const },
  { num: 3, label: 'Draft 提炼', countKey: 'topicDraft' as const },
  { num: 4, label: 'Wiki 审核', countKey: 'reviewQueue' as const },
]

export function PipelineProgress({ counts, activeStage, onStageClick }: PipelineProgressProps) {
  const total = (counts.qaPending > 0 ? 1 : 0) +
    (counts.unclassified > 0 ? 1 : 0) +
    (counts.topicDraft > 0 ? 1 : 0) +
    (counts.reviewQueue > 0 ? 1 : 0)
  const pct = total > 0 ? Math.round((total / 4) * 100) : 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-700">知识沉淀进度</span>
        <span className="text-[10px] text-gray-400">{pct}%</span>
      </div>
      <div className="flex gap-1 mb-3">
        {STAGES.map(s => (
          <div
            key={s.num}
            className={`h-1.5 flex-1 rounded-full transition ${
              counts[s.countKey] === 0 ? 'bg-gray-200' :
              activeStage === s.num ? 'bg-cyber-blue' : 'bg-cyber-blue/30'
            }`}
          />
        ))}
      </div>
      <div className="flex gap-2">
        {STAGES.map(s => (
          <button
            key={s.num}
            onClick={() => onStageClick(s.num)}
            className={`flex-1 text-center px-2 py-1.5 rounded-lg text-[10px] font-bold transition ${
              activeStage === s.num
                ? 'bg-cyber-blue/10 text-cyber-blue'
                : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            }`}
          >
            {s.label}
            {counts[s.countKey] > 0 && (
              <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 text-[9px]">
                {counts[s.countKey]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/knowledge/PipelineProgress.tsx
git commit -m "feat(ui): add PipelineProgress shared component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: DraftEditor — shared left/right split editor

**Files:**
- Create: `frontend/src/components/knowledge/DraftEditor.tsx`

**Interfaces:**
- Produces: `<DraftEditor>` component with `qaEntries` on left, editable `draftContent` on right

- [ ] **Step 1: Create component**

Write `frontend/src/components/knowledge/DraftEditor.tsx`:

```tsx
interface QaSummary {
  qid: number
  question: string
  answer?: string | null
}

interface DraftEditorProps {
  qaEntries: QaSummary[]
  draftContent: string
  onChange: (content: string) => void
  readOnly?: boolean
}

export function DraftEditor({ qaEntries, draftContent, onChange, readOnly = false }: DraftEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left: QA raw content */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          💧 关联问答 ({qaEntries.length})
        </h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {qaEntries.map(qa => (
            <div key={qa.qid} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
              <span className="font-mono text-cyber-blue font-bold text-[10px]">#Q{qa.qid}</span>
              <p className="mt-1 font-medium text-gray-800">{qa.question}</p>
              {qa.answer && (
                <p className="mt-1 text-gray-500 line-clamp-4">{qa.answer}</p>
              )}
            </div>
          ))}
          {qaEntries.length === 0 && (
            <div className="text-center text-gray-400 py-4 text-xs">暂无关联 QA</div>
          )}
        </div>
      </div>

      {/* Right: Draft editor */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">
          🧊 Draft 提炼
        </h3>
        <textarea
          value={draftContent}
          onChange={e => onChange(e.target.value)}
          readOnly={readOnly}
          rows={18}
          className={`w-full text-sm border border-gray-200 rounded-lg p-3 font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical ${
            readOnly ? 'bg-gray-50' : 'bg-white'
          }`}
          placeholder="点击「生成 Draft」或手动输入..."
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/knowledge/DraftEditor.tsx
git commit -m "feat(ui): add DraftEditor split-view shared component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: QaCalibrateCard — stage 1 component

**Files:**
- Create: `frontend/src/pages/admin/QaCalibrateCard.tsx`

**Interfaces:**
- Consumes: `fetchQaEntries`, `calibrateQaEntry` from api/client
- Produces: `<QaCalibrateCard>` with `onUpdate` callback

- [ ] **Step 1: Create component**

Write `frontend/src/pages/admin/QaCalibrateCard.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { fetchQaEntries, calibrateQaEntry } from '@/api/client'
import type { QaEntry } from '@/types'
import { CheckCircle, Eye, ChevronDown, ChevronRight } from 'lucide-react'

interface QaCalibrateCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function QaCalibrateCard({ expanded, onToggle, onUpdate }: QaCalibrateCardProps) {
  const [pendingQa, setPendingQa] = useState<QaEntry[]>([])
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchQaEntries({ status: 'pending', limit: 50 })
      .then(d => setPendingQa(d.entries))
      .catch(() => {})
  }, [])

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    setLoading(true)
    await calibrateQaEntry(qid, answer)
    setPendingQa(prev => prev.filter(e => e.qid !== qid))
    setCalAnswers(prev => { const n = { ...prev }; delete n[qid]; return n })
    setLoading(false)
    onUpdate()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">① QA 校准</span>
          {pendingQa.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {pendingQa.length} 待校准
            </span>
          )}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {pendingQa.map(e => (
            <div key={e.qid} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyber-blue font-bold">#Q{e.qid}</span>
                <span className="text-sm font-medium">{e.question}</span>
              </div>
              {e.answer && (
                <p className="text-xs text-gray-500 bg-white rounded p-2 max-h-24 overflow-y-auto">
                  {e.answer}
                </p>
              )}
              <textarea
                value={calAnswers[e.qid] ?? ''}
                onChange={evt => setCalAnswers(prev => ({ ...prev, [e.qid]: evt.target.value }))}
                placeholder="输入校准答案..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => window.open(`/qa?qid=${e.qid}`, '_blank')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  <Eye className="w-3 h-3" /> 查看
                </button>
                <button onClick={() => handleCalibrate(e.qid)}
                  disabled={!calAnswers[e.qid]?.trim() || loading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                  <CheckCircle className="w-3 h-3" /> 校准
                </button>
              </div>
            </div>
          ))}
          {pendingQa.length === 0 && (
            <div className="text-center text-gray-400 py-4 text-sm">✅ 暂无待校准条目</div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/QaCalibrateCard.tsx
git commit -m "feat(admin): add QaCalibrateCard stage 1 component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: TopicDiscoverCard — stage 2 component

**Files:**
- Create: `frontend/src/pages/admin/TopicDiscoverCard.tsx`

**Interfaces:**
- Consumes: `analyzeTopics`, `generateDraft` from api/client
- Produces: `<TopicDiscoverCard>` with analyze trigger + results

- [ ] **Step 1: Create component**

Write `frontend/src/pages/admin/TopicDiscoverCard.tsx`:

```tsx
import { useState } from 'react'
import { analyzeTopics, generateDraft } from '@/api/client'
import type { TopicSuggestion } from '@/types'
import { Loader2, ChevronDown, ChevronRight, Plus, Check, X } from 'lucide-react'

interface TopicDiscoverCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function TopicDiscoverCard({ expanded, onToggle, onUpdate }: TopicDiscoverCardProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([])
  const [matched, setMatched] = useState<TopicSuggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmedSlugs, setConfirmedSlugs] = useState<Set<string>>(new Set())
  const [generatingSlugs, setGeneratingSlugs] = useState<Set<string>>(new Set())

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeTopics()
      setSuggestions(result.suggestions || [])
      setMatched(result.matched || [])
      if (result.total_new === 0 && (result.matched || []).length === 0) {
        setError('未发现可聚合的 Topic，QA 池可能需要更多数据')
      }
    } catch (e: any) {
      setError(e.message || '分析失败')
    }
    setAnalyzing(false)
    onUpdate()
  }

  const handleConfirmAndGenerate = async (slug: string) => {
    setGeneratingSlugs(prev => new Set(prev).add(slug))
    try {
      await generateDraft(slug)
      setConfirmedSlugs(prev => new Set(prev).add(slug))
    } catch {}
    setGeneratingSlugs(prev => { const n = new Set(prev); n.delete(slug); return n })
    onUpdate()
  }

  const handleRejectSuggestion = (slug: string) => {
    setSuggestions(prev => prev.filter(s => s.slug !== slug))
  }

  const totalCount = suggestions.length + matched.length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">② Topic 发现</span>
          {totalCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold">
              {totalCount} 建议
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          <button onClick={handleAnalyze} disabled={analyzing}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-cyber-blue text-white text-sm font-bold rounded-xl hover:bg-cyber-blue-dark disabled:opacity-50 transition">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {analyzing ? 'LLM 分析中...' : '分析 QA 池'}
          </button>

          {error && (
            <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* New suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">
                🆕 新 Topic 建议
              </h3>
              {suggestions.map(s => (
                <div key={s.slug}
                  className={`border rounded-lg p-3 text-xs space-y-2 ${
                    confirmedSlugs.has(s.slug) ? 'border-green-200 bg-green-50' : 'border-purple-200 bg-purple-50/50'
                  }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-gray-800">#{s.slug}</span>
                      <span className="ml-2 font-medium text-gray-700">{s.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-400">{s.qa_ids.length} QA</span>
                  </div>
                  <p className="text-gray-500">{s.description}</p>
                  {confirmedSlugs.has(s.slug) ? (
                    <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                      <Check className="w-3 h-3" /> Draft 已生成
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => handleConfirmAndGenerate(s.slug)}
                        disabled={generatingSlugs.has(s.slug)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                        {generatingSlugs.has(s.slug) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        确认并生成 Draft
                      </button>
                      <button onClick={() => handleRejectSuggestion(s.slug)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                        <X className="w-3 h-3" /> 忽略
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Matched to existing topics */}
          {matched.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">
                🔗 已匹配到已有 Topic
              </h3>
              {matched.map(m => (
                <div key={m.slug} className="border border-cyber-blue/20 bg-cyber-blue/5 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-gray-800">#{m.slug}</span>
                      <span className="ml-2 text-gray-500">+{m.qa_ids.length} QA 已关联</span>
                    </div>
                    <Check className="w-3 h-3 text-cyber-green" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {suggestions.length === 0 && matched.length === 0 && !analyzing && (
            <div className="text-center text-gray-400 py-4 text-sm">
              点击上方按钮，让 LLM 分析 QA 池
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/TopicDiscoverCard.tsx
git commit -m "feat(admin): add TopicDiscoverCard stage 2 component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: DraftRefineCard — stage 3 component

**Files:**
- Create: `frontend/src/pages/admin/DraftRefineCard.tsx`

**Interfaces:**
- Consumes: `fetchTopics`, `fetchTopic`, `fetchTopicDraft`, `generateDraft`, `updateTopicDraft`, `submitDraft` from api/client
- Consumes: `DraftEditor` component
- Produces: `<DraftRefineCard>` with topic list → draft editor → submit

- [ ] **Step 1: Create component**

Write `frontend/src/pages/admin/DraftRefineCard.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { fetchTopics, fetchTopic, fetchTopicDraft, generateDraft, updateTopicDraft, submitDraft } from '@/api/client'
import { DraftEditor } from '@/components/knowledge/DraftEditor'
import type { Topic, TopicDraft } from '@/types'
import { Loader2, ChevronDown, ChevronRight, Send, Sparkles, Eye, PenLine } from 'lucide-react'

interface TopicDetail extends Topic {
  qa_entries?: { qid: number; question: string; answer?: string | null }[]
}

interface DraftRefineCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function DraftRefineCard({ expanded, onToggle, onUpdate }: DraftRefineCardProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState<TopicDetail | null>(null)
  const [draft, setDraft] = useState<TopicDraft | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchTopics().then(all => setTopics(all.filter(t => t.status === 'pool'))).catch(() => {})
  }, [])

  const handleSelectTopic = async (slug: string) => {
    try {
      const topic = await fetchTopic(slug) as TopicDetail
      setSelectedTopic(topic)
      const d = await fetchTopicDraft(slug)
      setDraft(d)
      setDraftContent(d?.edited_content || d?.raw_content || '')
      setFeedback(null)
    } catch {}
  }

  const handleGenerateDraft = async () => {
    if (!selectedTopic) return
    setGenerating(true)
    try {
      const result = await generateDraft(selectedTopic.slug)
      setDraft(result)
      setDraftContent(result.raw_content || '')
      setFeedback('✅ Draft 已生成，请检查并编辑后提交')
    } catch (e: any) {
      setFeedback(`❌ 生成失败: ${e.message}`)
    }
    setGenerating(false)
  }

  const handleSave = async () => {
    if (!selectedTopic) return
    setSaving(true)
    try {
      await updateTopicDraft(selectedTopic.slug, draftContent)
      setFeedback('✅ 已保存')
    } catch (e: any) {
      setFeedback(`❌ 保存失败: ${e.message}`)
    }
    setSaving(false)
  }

  const handleSubmit = async () => {
    if (!selectedTopic) return
    setSubmitting(true)
    try {
      await updateTopicDraft(selectedTopic.slug, draftContent)
      await submitDraft(selectedTopic.slug)
      setTopics(prev => prev.filter(t => t.slug !== selectedTopic.slug))
      setSelectedTopic(null)
      setDraft(null)
      setFeedback(null)
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 提交失败: ${e.message}`)
    }
    setSubmitting(false)
  }

  const pendingCount = topics.length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">③ Draft 提炼</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {pendingCount} 待提炼
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {selectedTopic ? (
            <>
              {/* Back button + topic info */}
              <div className="flex items-center justify-between">
                <button onClick={() => { setSelectedTopic(null); setDraft(null) }}
                  className="text-xs text-gray-500 hover:text-cyber-blue">← 返回 Topic 列表</button>
                <span className="text-sm font-bold text-gray-800">
                  #{selectedTopic.slug} · {selectedTopic.name}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPreviewMode(!previewMode)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-200 rounded hover:bg-gray-50">
                    {previewMode ? <PenLine className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {previewMode ? '编辑' : '预览'}
                  </button>
                </div>
              </div>

              {previewMode ? (
                <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm prose prose-slate max-w-none whitespace-pre-wrap">
                  {draftContent || '(空内容)'}
                </div>
              ) : (
                <DraftEditor
                  qaEntries={selectedTopic.qa_entries || []}
                  draftContent={draftContent}
                  onChange={setDraftContent}
                />
              )}

              {feedback && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  feedback.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'
                }`}>
                  {feedback}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button onClick={handleGenerateDraft} disabled={generating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-cyber-blue/30 text-cyber-blue rounded-lg hover:bg-cyber-blue/5 disabled:opacity-50">
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {draft ? '重新生成' : '生成 Draft'}
                </button>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving || !draftContent}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    保存
                  </button>
                  <button onClick={handleSubmit} disabled={submitting || !draftContent}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-cyber-blue text-white text-xs rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    提交审核
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {topics.map(t => (
                <button key={t.slug} onClick={() => handleSelectTopic(t.slug)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                    <span className="text-xs text-gray-500">{t.name}</span>
                    {t.qa_count != null && (
                      <span className="text-[10px] text-gray-400 bg-white px-1.5 py-0.5 rounded">{t.qa_count} QA</span>
                    )}
                  </div>
                  <span className="text-[10px] text-cyber-blue font-bold">编辑 →</span>
                </button>
              ))}
              {topics.length === 0 && (
                <div className="text-center text-gray-400 py-4 text-sm">
                  暂无待提炼的 Topic，请先在阶段②中生成
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/DraftRefineCard.tsx
git commit -m "feat(admin): add DraftRefineCard stage 3 component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: WikiReviewCard — stage 4 component

**Files:**
- Create: `frontend/src/pages/admin/WikiReviewCard.tsx`

**Interfaces:**
- Consumes: `fetchReviewQueue`, `fetchWikiModules`, `approveDraft`, `rejectDraft` from api/client
- Consumes: `DraftEditor` component
- Produces: `<WikiReviewCard>` with review queue → preview → approve/reject

- [ ] **Step 1: Create component**

Write `frontend/src/pages/admin/WikiReviewCard.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { fetchReviewQueue, fetchWikiModules, approveDraft, rejectDraft } from '@/api/client'
import { DraftEditor } from '@/components/knowledge/DraftEditor'
import type { ReviewItem } from '@/types'
import { Loader2, ChevronDown, ChevronRight, CheckCircle, XCircle, BookOpen, Eye } from 'lucide-react'

interface WikiReviewCardProps {
  expanded: boolean
  onToggle: () => void
  onUpdate: () => void
}

export function WikiReviewCard({ expanded, onToggle, onUpdate }: WikiReviewCardProps) {
  const [queue, setQueue] = useState<ReviewItem[]>([])
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const [selectedModule, setSelectedModule] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchReviewQueue().then(d => setQueue(d.queue || [])).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  const handleSelect = (item: ReviewItem) => {
    setSelectedItem(item)
    setFeedback(null)
    setShowRejectInput(false)
    if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].slug)
  }

  const handleApprove = async () => {
    if (!selectedItem || !selectedModule) return
    setLoading(true)
    try {
      await approveDraft(selectedItem.topic_slug, selectedModule)
      setQueue(prev => prev.filter(i => i.topic_slug !== selectedItem.topic_slug))
      setSelectedItem(null)
      setFeedback('✅ 已发布到 Wiki 并索引到检索库')
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 发布失败: ${e.message}`)
    }
    setLoading(false)
  }

  const handleReject = async () => {
    if (!selectedItem) return
    setLoading(true)
    try {
      await rejectDraft(selectedItem.topic_slug, rejectReason || '需要进一步修改')
      setQueue(prev => prev.filter(i => i.topic_slug !== selectedItem.topic_slug))
      setSelectedItem(null)
      setShowRejectInput(false)
      setRejectReason('')
      onUpdate()
    } catch (e: any) {
      setFeedback(`❌ 驳回失败: ${e.message}`)
    }
    setLoading(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className="text-lg">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="text-sm font-bold text-gray-900">④ Wiki 审核</span>
          {queue.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-cyber-green/10 text-cyber-green text-[10px] font-bold">
              {queue.length} 待审核
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {selectedItem ? (
            <>
              <button onClick={() => { setSelectedItem(null); setShowRejectInput(false) }}
                className="text-xs text-gray-500 hover:text-cyber-blue">← 返回审核列表</button>

              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-gray-800">#{selectedItem.topic_slug}</span>
                <span className="text-sm text-gray-600">{selectedItem.topic_name}</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">🆕 新 Draft</span>
              </div>

              <DraftEditor
                qaEntries={[]}
                draftContent={selectedItem.edited_content || selectedItem.raw_content}
                onChange={() => {}}
                readOnly
              />

              {feedback && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  feedback.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'
                }`}>
                  {feedback}
                </div>
              )}

              {/* Module selector + actions */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-400" />
                  <span className="text-xs text-gray-600">目标模块:</span>
                  <select value={selectedModule} onChange={e => setSelectedModule(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                    {modules.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                  </select>
                </div>

                <div className="flex gap-2">
                  {showRejectInput ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="驳回理由..."
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-48"
                      />
                      <button onClick={handleReject} disabled={loading}
                        className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
                        确认驳回
                      </button>
                      <button onClick={() => setShowRejectInput(false)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                        取消
                      </button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => setShowRejectInput(true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50">
                        <XCircle className="w-3 h-3" /> 驳回
                      </button>
                      <button onClick={handleApprove} disabled={!selectedModule || loading}
                        className="inline-flex items-center gap-1 px-4 py-1.5 bg-cyber-blue text-white text-xs rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        批准发布
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {queue.map(item => (
                <button key={item.topic_slug} onClick={() => handleSelect(item)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{item.topic_slug}</span>
                    <span className="text-xs text-gray-500">{item.topic_name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">🆕</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{item.updated_at?.slice(0, 10)}</span>
                    <Eye className="w-3 h-3 text-gray-400" />
                  </div>
                </button>
              ))}
              {queue.length === 0 && (
                <div className="text-center text-gray-400 py-4 text-sm">
                  暂无待审核的 Draft，提交后在阶段③中操作
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/WikiReviewCard.tsx
git commit -m "feat(admin): add WikiReviewCard stage 4 component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: AdminPage Rewrite — pipeline container

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`
- Remove: drawer content logic (now self-contained pipeline)

**Interfaces:**
- Consumes: All 4 stage card components + PipelineProgress
- Produces: Full pipeline page

- [ ] **Step 1: Rewrite AdminPage**

Write `frontend/src/pages/AdminPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { fetchQaEntries, fetchTopics, fetchReviewQueue } from '@/api/client'
import { PipelineProgress } from '@/components/knowledge/PipelineProgress'
import { QaCalibrateCard } from '@/pages/admin/QaCalibrateCard'
import { TopicDiscoverCard } from '@/pages/admin/TopicDiscoverCard'
import { DraftRefineCard } from '@/pages/admin/DraftRefineCard'
import { WikiReviewCard } from '@/pages/admin/WikiReviewCard'
import type { PipelineCounts } from '@/types'

export function AdminPage() {
  const [counts, setCounts] = useState<PipelineCounts>({
    qaPending: 0,
    unclassified: 0,
    topicDraft: 0,
    reviewQueue: 0,
  })
  const [expandedStage, setExpandedStage] = useState<number | null>(1)

  const refreshCounts = useCallback(async () => {
    try {
      const [qaData, topics, reviewData] = await Promise.all([
        fetchQaEntries({ status: 'pending', limit: 1 }),
        fetchTopics(),
        fetchReviewQueue(),
      ])
      const poolTopics = topics.filter(t => t.status === 'pool')
      setCounts({
        qaPending: qaData.total,
        unclassified: qaData.total, // rough: all pending QA are unclassified
        topicDraft: poolTopics.length,
        reviewQueue: (reviewData.queue || []).length,
      })
    } catch {}
  }, [])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts])

  const handleStageToggle = (stage: number) => {
    setExpandedStage(prev => prev === stage ? null : stage)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-lg font-bold text-gray-900">知识沉淀</h1>
            <p className="text-xs text-gray-400 -mt-2">
              QA 校准 → Topic 发现 → Draft 提炼 → Wiki 审核 → 自进化知识库
            </p>

            <PipelineProgress
              counts={counts}
              activeStage={expandedStage}
              onStageClick={handleStageToggle}
            />

            <QaCalibrateCard
              expanded={expandedStage === 1}
              onToggle={() => handleStageToggle(1)}
              onUpdate={refreshCounts}
            />

            <TopicDiscoverCard
              expanded={expandedStage === 2}
              onToggle={() => handleStageToggle(2)}
              onUpdate={refreshCounts}
            />

            <DraftRefineCard
              expanded={expandedStage === 3}
              onToggle={() => handleStageToggle(3)}
              onUpdate={refreshCounts}
            />

            <WikiReviewCard
              expanded={expandedStage === 4}
              onToggle={() => handleStageToggle(4)}
              onUpdate={refreshCounts}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): rewrite AdminPage as four-stage pipeline container

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: Build verification and smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Build frontend**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npx vite build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Start backend and verify API health**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && timeout 5 python -c "
from database import init_databases; init_databases()
from stores.topics import analyze_qa_pool, generate_draft_for_topic, submit_draft, approve_draft, reject_draft, get_review_queue
from stores.wiki import index_wiki_page, search_wiki_index
print('All imports OK')
# Test review queue on empty DB
queue = get_review_queue()
print(f'Review queue (should be empty): {len(queue)}')
# Test wiki search
results = search_wiki_index('test')
print(f'Wiki search (should be empty): {len(results)}')
print('Smoke test passed')
" 2>&1
```

Expected: `Smoke test passed`

- [ ] **Step 3: Test analyze endpoint with empty QA pool**

```bash
cd /home/long2015/Code/OpenCodeWiki/backend && python -c "
from stores.topics import analyze_qa_pool
result = analyze_qa_pool()
assert result['total_new'] == 0
assert result['suggestions'] == []
print('Empty pool test passed:', result)
"
```

Expected: `Empty pool test passed`

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git diff --cached --stat
# Only commit if there are meaningful verification changes
```

---

### Task 15: Optional — update architecture doc

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update the knowledge pipeline section in ARCHITECTURE.md**

In the "核心业务模块 → 2. Topic 聚合" section, update to reflect the new pipeline:

```markdown
### 2. 知识沉淀管线 (`/admin`)

四阶段半自动管线：

1. **QA 校准** — 待校准 QA 列表，管理员输入标准答案
2. **Topic 发现** — LLM 批量分析 QA 池，自动建议 topic 聚类
3. **Draft 提炼** — LLM 按模板（概述/场景/方案/注意事项）生成结构化文档
4. **Wiki 审核** — 待发布 Draft 审核队列，批准后写入 Wiki + FTS5 索引

自进化闭环：
- **RAG 增强**：Wiki 内容通过 FTS5 索引在 QA 时作为上下文注入
- **反馈修正**：Wiki 被标记需修正后进入重新审核流
```

Replace lines 125-131.

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update architecture for knowledge pipeline v2

Co-Authored-By: Claude <noreply@anthropic.com>"
```
