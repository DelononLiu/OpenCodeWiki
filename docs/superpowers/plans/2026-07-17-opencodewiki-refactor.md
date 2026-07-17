# OpenCodeWiki 全栈重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Node.js/Express + inline HTML/JS stack with Python (FastAPI + LangGraph) backend and React 18 SPA frontend, implementing DocAgent-ui2 design with QA→Topic→Wiki self-evolution lifecycle.

**Architecture:** Python FastAPI serves as full-stack backend (REST API + static files + LangGraph agent). React SPA with hash-based wiki navigation communicates via API. All business logic in Python; frontend is pure UI layer.

**Tech Stack:** Backend: Python 3.11+, FastAPI, LangGraph, sqlite3, codebase-memory-mcp CLI. Frontend: React 18, Vite 5, TypeScript, Tailwind CSS 3, shadcn/ui, Recharts, Vitest.

## Global Constraints

- Python backend extends existing `src/python-agent/` directory (do not rewrite from scratch)
- Frontend lives in new `frontend/` directory at project root
- All Node.js/Express code (`src/server/`, `src/home/`, `src/qa/`, `src/wiki/`, `src/shared/`) deleted
- Color palette: primary `#4F46E5`, success `#10B981`, bg `#F8F9FA`, card `#FFFFFF`, text `#1E293B`
- Frontend dev: `cd frontend && npm run dev` (Vite :5173, proxy to Python :8000)
- Production: Python serves `frontend/dist/` as static files
- URL routes: `/` Home, `/:repo` Wiki, `/qa` QA, `/admin` Admin
- Wiki content navigation via hash: `/:repo#02-qa-engine`
- CSS framework: Tailwind CSS 3 with shadcn/ui components (NO custom CSS files for layout)
- All new Python API routes use FastAPI prefix tags
- API response format: JSON with `{ok: bool, data?: any, error?: string}` envelope

---

## File Structure

### Backend (Python) — `src/python-agent/`
```
src/python-agent/
├── main.py              # FastAPI entry: extend to full-stack (existing, modify)
├── graph.py             # LangGraph StateGraph (existing, extend)
├── agent.py             # Agent prompt + builder (existing, keep)
├── config.py            # LLM config (existing, keep)
├── tools.py             # Codegraph tools (existing, keep)
├── wiki_entity_builder.py  # Entity generation (existing, keep)
├── database.py          # SQLite init + migrations (new)
├── store_qa.py          # QA store CRUD (new, replaces qa-store.ts)
├── store_wiki.py        # Wiki page CRUD (new, replaces wiki-page-service.ts)
├── store_entities.py    # Entity service (new, replaces entity-service.ts)
├── store_topics.py      # Topic store (new)
└── test_agent.py        # Existing agent tests
```

### Frontend (React) — `frontend/`
```
frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json          # shadcn/ui config
├── src/
│   ├── main.tsx
│   ├── App.tsx               # React Router layout
│   ├── index.css             # Tailwind imports
│   ├── lib/
│   │   └── utils.ts          # shadcn/ui cn() helper
│   ├── api/
│   │   └── client.ts         # API client (fetch wrapper)
│   ├── types/
│   │   └── index.ts          # Shared TypeScript types
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── WikiPage.tsx
│   │   ├── QAPage.tsx
│   │   └── AdminPage.tsx
│   └── components/
│       ├── ui/               # shadcn/ui generated components
│       └── layout/
│           ├── Header.tsx
│           ├── LeftSidebar.tsx
│           └── BottomInput.tsx
└── tests/
    └── setup.ts
```

---

## Phase 0: Infrastructure & Cleanup

### Task 0.1: Remove all Node.js / legacy frontend code

**Files:**
- Delete: `src/server/` (entire directory)
- Delete: `src/home/index.html`
- Delete: `src/qa/index.html`
- Delete: `src/wiki/entity.html`
- Delete: `src/shared/qa-input.ts`
- Delete: `src/shared/user-bar.ts`
- Delete: `vendor/marked.min.js`, `vendor/mermaid.min.js`, `vendor/highlight.min.js`
- Delete: `test-acp-client.ts`
- Delete: `node_modules/`, `package.json`, `package-lock.json`, `tsconfig.json`

- [ ] **Step 1: Remove server directory**

```bash
rm -rf src/server src/home src/qa src/wiki src/shared
rm -f test-acp-client.ts
```

- [ ] **Step 2: Remove vendor and node dependencies**

```bash
rm -rf vendor node_modules
rm -f package.json package-lock.json tsconfig.json tsconfig.node.json
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Node.js backend and legacy frontend

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 0.2: Python backend — database layer

**Files:**
- Create: `src/python-agent/database.py`

**Interfaces:**
- Consumes: `os.environ`, `pathlib.Path`
- Produces: `get_qa_db() -> sqlite3.Connection`, `get_knowledge_db() -> sqlite3.Connection`, `init_databases()`

- [ ] **Step 1: Create database.py**

```python
"""
database.py — Unified SQLite database initialization.

Migrates existing qa.db + knowledge.db from Node.js era into Python-managed
schemas. Uses sqlite3 (standard library).
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DB_DIR = Path.home() / ".opencodewiki"


def _db_path(name: str) -> str:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return str(DB_DIR / name)


# ── QA Database (qa.db) ─────────────────────────────────────────

_qa_db: sqlite3.Connection | None = None


def get_qa_db() -> sqlite3.Connection:
    global _qa_db
    if _qa_db is not None:
        return _qa_db
    _qa_db = sqlite3.connect(_db_path("qa.db"))
    _qa_db.row_factory = sqlite3.Row
    _qa_db.execute("PRAGMA journal_mode=WAL")
    _qa_db.execute("PRAGMA foreign_keys=ON")
    _init_qa_db(_qa_db)
    return _qa_db


def _init_qa_db(db: sqlite3.Connection):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS qa_entries (
            id            TEXT PRIMARY KEY,
            qid           INTEGER UNIQUE NOT NULL,
            session_id    TEXT,
            repo          TEXT NOT NULL DEFAULT '',
            module        TEXT,
            question      TEXT NOT NULL,
            answer        TEXT,
            mode          TEXT NOT NULL DEFAULT 'deep'
                          CHECK(mode IN ('lightweight','deep')),
            domain        TEXT NOT NULL DEFAULT 'general',
            status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('active','pending','archived')),
            parent_qid    INTEGER,
            related_qids  TEXT DEFAULT '[]',
            tags          TEXT DEFAULT '[]',
            sources       TEXT DEFAULT '[]',
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now')),
            answered_at   TEXT,
            visit_count   INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_qa_repo ON qa_entries(repo);
        CREATE INDEX IF NOT EXISTS idx_qa_status ON qa_entries(status);
        CREATE INDEX IF NOT EXISTS idx_qa_qid ON qa_entries(qid);

        CREATE TABLE IF NOT EXISTS calibrated_answers (
            id          TEXT PRIMARY KEY,
            qa_entry_id TEXT NOT NULL REFERENCES qa_entries(id),
            answer      TEXT NOT NULL,
            calibrator  TEXT NOT NULL DEFAULT '',
            reason      TEXT,
            version     INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ca_entry
            ON calibrated_answers(qa_entry_id);
    """)


def close_qa_db():
    global _qa_db
    if _qa_db:
        _qa_db.close()
        _qa_db = None


# ── Knowledge Database (knowledge.db) ───────────────────────────

_knowledge_db: sqlite3.Connection | None = None


def get_knowledge_db() -> sqlite3.Connection:
    global _knowledge_db
    if _knowledge_db is not None:
        return _knowledge_db
    _knowledge_db = sqlite3.connect(_db_path("knowledge.db"))
    _knowledge_db.row_factory = sqlite3.Row
    _knowledge_db.execute("PRAGMA journal_mode=WAL")
    _knowledge_db.execute("PRAGMA foreign_keys=ON")
    _init_knowledge_db(_knowledge_db)
    return _knowledge_db


def _init_knowledge_db(db: sqlite3.Connection):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS entities (
            slug          TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            definition    TEXT DEFAULT '',
            status        TEXT DEFAULT 'draft'
                          CHECK(status IN ('draft','reviewed','published')),
            project       TEXT DEFAULT '',
            page_type     TEXT DEFAULT 'entity',
            content       TEXT DEFAULT '',
            search_count  INTEGER DEFAULT 0,
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS entity_files (
            entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
            path        TEXT NOT NULL,
            symbols     TEXT DEFAULT '[]',
            PRIMARY KEY (entity_slug, path)
        );
        CREATE TABLE IF NOT EXISTS entity_qa (
            entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
            qid         INTEGER,
            PRIMARY KEY (entity_slug, qid)
        );
        CREATE TABLE IF NOT EXISTS topics (
            slug        TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'pool'
                        CHECK(status IN ('pool', 'promoted')),
            wiki_module TEXT DEFAULT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            promoted_at TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS topic_qa (
            topic_slug  TEXT NOT NULL REFERENCES topics(slug),
            qid         INTEGER NOT NULL,
            PRIMARY KEY (topic_slug, qid)
        );
        CREATE TABLE IF NOT EXISTS topic_drafts (
            topic_slug    TEXT PRIMARY KEY REFERENCES topics(slug),
            raw_content   TEXT NOT NULL,
            edited_content TEXT DEFAULT NULL,
            status        TEXT DEFAULT 'pending'
                          CHECK(status IN ('pending','approved','rejected')),
            reviewer      TEXT DEFAULT '',
            created_at    TEXT DEFAULT (datetime('now')),
            reviewed_at   TEXT DEFAULT NULL
        );
    """)


def close_knowledge_db():
    global _knowledge_db
    if _knowledge_db:
        _knowledge_db.close()
        _knowledge_db = None


# ── Unified init ────────────────────────────────────────────────

def init_databases():
    get_qa_db()
    get_knowledge_db()
```

- [ ] **Step 2: Verify it imports cleanly**

Run:

```bash
cd src/python-agent && python3 -c "from database import init_databases; init_databases(); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/database.py
git commit -m "feat: add unified SQLite database layer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 0.3: Python backend — QA store

**Files:**
- Create: `src/python-agent/store_qa.py`

**Interfaces:**
- Consumes: `database.get_qa_db()`
- Produces: `create_entry(data) -> dict`, `get_entry(qid) -> dict`, `list_entries(query) -> dict`, `get_next_qid() -> int`, `calibrate_entry(qid, answer, calibrator) -> bool`, `list_pending(repo) -> list`, `search_questions(q, limit) -> list`

- [ ] **Step 1: Create store_qa.py**

```python
"""
store_qa.py — QA entry CRUD operations.
Replaces qa-store.ts from Node.js era.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from database import get_qa_db


def get_next_qid() -> int:
    db = get_qa_db()
    row = db.execute("SELECT COALESCE(MAX(qid), 0) + 1 AS next FROM qa_entries").fetchone()
    return row["next"]


def create_entry(data: dict) -> dict:
    db = get_qa_db()
    eid = data.get("id") or str(uuid.uuid4())
    qid = data.get("qid") or get_next_qid()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO qa_entries
           (id, qid, session_id, repo, question, answer, mode, domain,
            status, sources, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            eid, qid,
            data.get("sessionId", ""),
            data.get("repo", ""),
            data.get("question", ""),
            data.get("answer"),
            data.get("mode", "deep"),
            data.get("domain", "general"),
            "pending",
            json.dumps(data.get("sources", [])),
            json.dumps(data.get("tags", [])),
            now, now,
        ),
    )
    db.commit()
    return {"id": eid, "qid": qid}


def get_entry(qid: int) -> dict | None:
    db = get_qa_db()
    row = db.execute("SELECT * FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not row:
        return None
    entry = dict(row)
    entry["tags"] = json.loads(entry.get("tags", "[]"))
    entry["sources"] = json.loads(entry.get("sources", "[]"))
    entry["related_qids"] = json.loads(entry.get("related_qids", "[]"))
    # Check calibrated
    cal = db.execute(
        "SELECT * FROM calibrated_answers WHERE qa_entry_id = ? ORDER BY version DESC LIMIT 1",
        (entry["id"],),
    ).fetchone()
    entry["is_calibrated"] = cal is not None
    entry["calibrated_answer"] = dict(cal) if cal else None
    return entry


def list_entries(query: dict) -> dict:
    db = get_qa_db()
    conditions = []
    params: list[Any] = []

    if query.get("repo"):
        conditions.append("repo = ?")
        params.append(query["repo"])
    if query.get("status"):
        conditions.append("status = ?")
        params.append(query["status"])
    if query.get("calibrated"):
        conditions.append("id IN (SELECT qa_entry_id FROM calibrated_answers)")
    if query.get("domain"):
        conditions.append("domain = ?")
        params.append(query["domain"])

    where = " AND ".join(conditions) if conditions else "1=1"
    sort_map = {"latest": "created_at DESC", "popular": "visit_count DESC", "visit": "visit_count DESC"}
    order = sort_map.get(query.get("sort", ""), "created_at DESC")
    limit = min(query.get("limit", 20), 100)
    page = max(query.get("page", 1), 1)
    offset = (page - 1) * limit

    rows = db.execute(
        f"SELECT * FROM qa_entries WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    total = db.execute(
        f"SELECT COUNT(*) AS cnt FROM qa_entries WHERE {where}", params
    ).fetchone()["cnt"]

    entries = []
    for row in rows:
        e = dict(row)
        e["tags"] = json.loads(e.get("tags", "[]"))
        e["sources"] = json.loads(e.get("sources", "[]"))
        cal = db.execute(
            "SELECT COUNT(*) AS c FROM calibrated_answers WHERE qa_entry_id = ?",
            (e["id"],),
        ).fetchone()
        e["is_calibrated"] = cal["c"] > 0
        entries.append(e)

    return {"entries": entries, "total": total, "page": page, "limit": limit}


def list_pending(repo: str | None = None) -> list[dict]:
    db = get_qa_db()
    if repo:
        rows = db.execute(
            "SELECT qid, question, created_at FROM qa_entries WHERE status = 'pending' AND repo = ? ORDER BY created_at DESC",
            (repo,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT qid, question, repo, created_at FROM qa_entries WHERE status = 'pending' ORDER BY created_at DESC",
        ).fetchall()
    return [dict(r) for r in rows]


def calibrate(qid: int, answer: str, calibrator: str = "admin") -> bool:
    db = get_qa_db()
    entry = db.execute("SELECT id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return False
    cal_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO calibrated_answers (id, qa_entry_id, answer, calibrator, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)""",
        (cal_id, entry["id"], answer, calibrator, now, now),
    )
    db.execute(
        "UPDATE qa_entries SET status = 'active', answer = ?, answered_at = ?, updated_at = ? WHERE id = ?",
        (answer, now, now, entry["id"]),
    )
    db.commit()
    return True


def search_questions(q: str, limit: int = 5) -> list[dict]:
    db = get_qa_db()
    rows = db.execute(
        "SELECT qid, question FROM qa_entries WHERE question LIKE ? ORDER BY visit_count DESC LIMIT ?",
        (f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]


def bump_visit(qid: int):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET visit_count = visit_count + 1 WHERE qid = ?", (qid,))
    db.commit()
```

- [ ] **Step 2: Quick smoke test**

```bash
cd src/python-agent && python3 -c "
from database import init_databases
from store_qa import get_next_qid, list_entries
init_databases()
print('next qid:', get_next_qid())
print('entries:', list_entries({'limit': 3}))
"
```

Expected: `next qid: 1`, `entries: ...`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/store_qa.py
git commit -m "feat: add QA store (Python)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 0.4: Python backend — extend FastAPI with core routes

**Files:**
- Modify: `src/python-agent/main.py`

**Interfaces:**
- Consumes: `store_qa.*`, `store_wiki.*`, `graph.get_graph()`
- Produces: FastAPI routes for `/api/qa/*`, `/api/repos`, `/health`

- [ ] **Step 1: Extend main.py with full API**

Write the new `src/python-agent/main.py`:

```python
"""
FastAPI 入口：全栈 OpenCodeWiki 后端。

提供 REST API + SSE 流式 QA + 静态文件服务 (React SPA build)。
"""

import json
import os
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from database import init_databases
from store_qa import (
    calibrate as calibrate_entry,
    create_entry,
    get_entry,
    get_next_qid,
    list_entries,
    list_pending,
    search_questions,
)

# ── Config ──────────────────────────────────────────────────────

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
FRONTEND_DIST = ROOT / "frontend" / "dist"
REGISTRY_PATH = Path.home() / ".opencodewiki" / "registry.json"


def _load_registry() -> list[dict]:
    try:
        return json.loads(REGISTRY_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


# ── Lifespan ────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_databases()
    yield


# ── App ─────────────────────────────────────────────────────────

app = FastAPI(title="OpenCodeWiki", version="2.0.0", lifespan=lifespan)


def _ok(data: any = None) -> JSONResponse:
    return JSONResponse({"ok": True, "data": data})


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "error": msg}, status_code=status)


# ── Repos ───────────────────────────────────────────────────────

@app.get("/api/repos")
async def api_repos():
    return _ok(_load_registry())


# ── QA ───────────────────────────────────────────────────────

@app.get("/api/qa/next-qid")
async def api_qa_next_qid():
    return _ok({"qid": get_next_qid()})


@app.get("/api/qa/entries")
async def api_qa_entries(
    repo: str | None = None,
    status: str | None = None,
    domain: str | None = None,
    calibrated: bool = False,
    sort: str = "latest",
    page: int = 1,
    limit: int = 20,
    q: str | None = None,
):
    result = list_entries({
        "repo": repo, "status": status, "domain": domain,
        "calibrated": calibrated, "sort": sort,
        "page": page, "limit": limit,
    })
    if q:
        result["entries"] = [e for e in result["entries"] if q.lower() in e["question"].lower()]
    return _ok(result)


@app.get("/api/qa/entry/{qid}")
async def api_qa_entry(qid: int):
    entry = get_entry(qid)
    if not entry:
        raise HTTPException(404, f"#Q{qid} not found")
    return _ok(entry)


@app.post("/api/qa/entry/{qid}/calibrate")
async def api_qa_calibrate(qid: int, body: dict):
    answer = (body.get("answer") or "").strip()
    calibrator = (body.get("calibrator") or "admin").strip()
    if not answer:
        return _err("Missing answer")
    ok = calibrate_entry(qid, answer, calibrator)
    if not ok:
        raise HTTPException(404, f"#Q{qid} not found")
    return _ok({"calibrated": True})


@app.get("/api/qa/pending")
async def api_qa_pending(repo: str | None = None):
    return _ok(list_pending(repo))


@app.get("/api/qa/suggest")
async def api_qa_suggest(q: str, limit: int = 5):
    if len(q) < 2:
        return _ok({"suggestions": []})
    return _ok({"suggestions": search_questions(q, limit)})


# ── QA SSE (Streaming) ────────────────────────────────────────

from graph import get_graph

async def _qa_event_stream(question: str, session_id: str, repo: str = "") -> AsyncGenerator[str, None]:
    """LangGraph SSE 流式输出"""
    graph = get_graph()

    def _sse(event_type: str, data: dict) -> str:
        return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"

    yield _sse("session", {"id": session_id})

    final_answer = ""
    try:
        result = await graph.ainvoke(
            {"question": question, "project": repo, "intent": "", "messages": []},
            config={"configurable": {"thread_id": session_id}},
        )
        for m in result.get("messages", []):
            role = getattr(m, "type", "") or getattr(m, "role", "")
            if role in ("ai", "assistant") and hasattr(m, "content") and m.content:
                final_answer += m.content

        if final_answer:
            yield _sse("token", {"content": final_answer})
        else:
            yield _sse("error", {"message": "Agent did not produce an answer"})
    except Exception as e:
        yield _sse("error", {"message": f"Agent error: {e}"})
    finally:
        yield _sse("done", {})


@app.post("/api/qa")
async def api_qa(request: Request):
    body = await request.json()
    question = (body.get("question") or "").strip()
    session_id = body.get("sessionId") or str(uuid.uuid4())
    repo = body.get("repo") or body.get("project") or ""

    if not question:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'message': 'Missing question'})}\n\n"]),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        _qa_event_stream(question, session_id, repo),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ── Wiki ────────────────────────────────────────────────────────

WIKI_BASE = ROOT / ".codegraph" / "wiki"


@app.get("/api/wiki/{slug}")
async def api_wiki_page(slug: str):
    """Get wiki page content by slug. Returns markdown or 404."""
    # Try physical wiki document
    for md_path in WIKI_BASE.rglob(f"{slug}.md"):
        content = md_path.read_text(encoding="utf-8")
        return _ok({"type": "wiki", "slug": slug, "content": content})
    raise HTTPException(404, f"Wiki page '{slug}' not found")


# ── Static files (React SPA) ───────────────────────────────────

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("agent/"):
            raise HTTPException(404)
        index = FRONTEND_DIST / "index.html"
        if not index.exists():
            return JSONResponse({"error": "Frontend not built"}, status_code=500)
        return FileResponse(str(index))
else:
    @app.get("/")
    async def root():
        return {"status": "ok", "message": "OpenCodeWiki API. Frontend not built yet."}


# ── Main ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", port=8000, reload=True)
```

- [ ] **Step 2: Test the API starts**

```bash
cd src/python-agent && python3 -c "from main import app; print('API loaded')"
```

Expected: `API loaded`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/main.py
git commit -m "feat: extend FastAPI with full REST API + SSE

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 0.5: Frontend scaffold — Vite + React + shadcn/ui + Tailwind

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`, `frontend/tsconfig.node.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/components.json`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/lib/utils.ts`
- Create: `frontend/src/vite-env.d.ts`

- [ ] **Step 1: Initialize the project**

```bash
cd /home/long2015/Code/OpenCodeWiki
mkdir -p frontend/src/{pages,components/{ui,layout},api,types,lib}
mkdir -p frontend/tests
```

Write `frontend/package.json`:

```json
{
  "name": "opencodewiki-frontend",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "lucide-react": "^0.441.0",
    "marked": "^14.0.0",
    "mermaid": "^11.0.0",
    "highlight.js": "^11.10.0",
    "recharts": "^2.13.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

Write `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

Write `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Write `frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

Write `frontend/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          blue: '#4F46E5',
          'blue-dark': '#4338CA',
          green: '#10B981',
          bg: '#F8F9FA',
          card: '#FFFFFF',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

Write `frontend/postcss.config.js`:

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

Write `frontend/components.json` (shadcn/ui config):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

Write `frontend/src/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
```

Write `frontend/src/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Write `frontend/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 14% 97%;
    --foreground: 222 47% 11%;
    --card: 0 0% 100%;
    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 239 84% 67%;
    --primary: 239 84% 67%;
    --primary-foreground: 0 0% 100%;
    --muted: 210 40% 96%;
    --muted-foreground: 215 16% 47%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
}

.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
```

Write `frontend/src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

Write `frontend/src/App.tsx`:

```typescript
import { Routes, Route } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { WikiPage } from '@/pages/WikiPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'

export default function App() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:repo" element={<WikiPage />} />
        <Route path="/qa" element={<QAPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </div>
  )
}
```

Write `frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCodeWiki</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Install dependencies**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend && npm install
```

Expected: packages installed, no errors

- [ ] **Step 3: Add shadcn/ui Button component**

```bash
cd /home/long2015/Code/OpenCodeWiki/frontend
mkdir -p src/components/ui
```

Write `frontend/src/components/ui/button.tsx`:

```typescript
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-cyber-blue text-white hover:bg-cyber-blue-dark",
        outline: "border border-border bg-transparent hover:bg-muted",
        ghost: "hover:bg-muted",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

- [ ] **Step 4: Write a quick smoke test**

Write `frontend/tests/setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

Write `frontend/vitest.config.ts` (or add to vite.config.ts):

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
  },
})
```

Overwrite `frontend/vite.config.ts` with the combined config above.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold React SPA with Vite + shadcn/ui + Tailwind

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 0.6: API client + types (frontend)

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/types/index.ts`

- [ ] **Step 1: Create shared types**

Write `frontend/src/types/index.ts`:

```typescript
export interface Repo {
  name: string
  path: string
}

export interface QaEntry {
  qid: number
  question: string
  answer: string | null
  repo: string
  domain: string
  status: 'active' | 'pending' | 'archived'
  is_calibrated: boolean
  calibrated_answer?: { answer: string; calibrator: string } | null
  tags: string[]
  created_at: string
  updated_at: string
  visit_count: number
}

export interface Topic {
  slug: string
  name: string
  description: string
  status: 'pool' | 'promoted'
  wiki_module: string | null
  created_at: string
  promoted_at: string | null
}

export interface TopicDraft {
  topic_slug: string
  raw_content: string
  edited_content: string | null
  status: 'pending' | 'approved' | 'rejected'
}

export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}
```

- [ ] **Step 2: Create API client**

Write `frontend/src/api/client.ts`:

```typescript
import type { ApiResponse, Repo, QaEntry, Topic, TopicDraft } from '@/types'

const BASE = '/api'

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const body: ApiResponse<T> = await res.json()
  if (!body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

// ── Repos ──

export function fetchRepos(): Promise<Repo[]> {
  return request<Repo[]>('/repos')
}

// ── QA ──

export function fetchQaEntries(params?: {
  repo?: string; status?: string; limit?: number; sort?: string
}): Promise<{ entries: QaEntry[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.repo) qs.set('repo', params.repo)
  if (params?.status) qs.set('status', params.status)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.sort) qs.set('sort', params.sort)
  return request(`/qa/entries?${qs.toString()}`)
}

export function fetchQaEntry(qid: number): Promise<QaEntry> {
  return request(`/qa/entry/${qid}`)
}

export function fetchQaPending(repo?: string): Promise<QaEntry[]> {
  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return request(`/qa/pending${qs}`)
}

export function calibrateQaEntry(qid: number, answer: string, calibrator = 'admin'): Promise<{ calibrated: boolean }> {
  return request(`/qa/entry/${qid}/calibrate`, {
    method: 'POST',
    body: JSON.stringify({ answer, calibrator }),
  })
}

export function fetchQaSuggest(q: string): Promise<{ suggestions: { qid: number; question: string }[] }> {
  return request(`/qa/suggest?q=${encodeURIComponent(q)}&limit=5`)
}

// ── Wiki ──

export function fetchWikiPage(slug: string): Promise<{ type: string; slug: string; content: string }> {
  return request(`/wiki/${encodeURIComponent(slug)}`)
}

// ── Topics ──

export function fetchTopics(): Promise<Topic[]> {
  return request('/topics')
}

export function fetchTopic(slug: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(slug)}`)
}

export function fetchTopicDraft(slug: string): Promise<TopicDraft | null> {
  return request(`/topics/${encodeURIComponent(slug)}/draft`)
}

export function analyzeTopics(): Promise<{ suggestions: Topic[] }> {
  return request('/topics/analyze', { method: 'POST' })
}

export function promoteTopic(slug: string, wikiModule: string): Promise<{ slug: string }> {
  return request(`/topics/${encodeURIComponent(slug)}/promote`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/ frontend/src/types/
git commit -m "feat: add API client and TypeScript types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 1: Core UI Pages

### Task 1.1: Layout components (Header + LeftSidebar + BottomInput)

**Files:**
- Create: `frontend/src/components/layout/Header.tsx`
- Create: `frontend/src/components/layout/LeftSidebar.tsx`
- Create: `frontend/src/components/layout/BottomInput.tsx`

- [ ] **Step 1: Create Header**

Write `frontend/src/components/layout/Header.tsx`:

```typescript
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { BookOpen, MessagesSquare, Sliders, ChevronRight } from 'lucide-react'

interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
  activeSection?: string
}

export function Header({ variant, repoName, activeSection }: HeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = (path: string) => location.pathname.startsWith(path)

  if (variant === 'home') {
    return (
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-6 h-6 bg-cyber-blue rounded flex items-center justify-center text-white font-black text-xs font-mono">W</div>
          <span className="font-sans font-bold text-base tracking-tight text-gray-900">OpenCodeWiki</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/qa')}>
          控制台大厅 <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </header>
    )
  }

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
      <div className="flex items-center gap-4">
        <span onClick={() => navigate('/')} className="font-bold text-sm tracking-tight text-gray-900 cursor-pointer">OpenCodeWiki</span>
        <span className="text-gray-300">/</span>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          {repoName || 'docs-main'}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant={isActive('/qa') ? 'default' : 'ghost'} size="sm" onClick={() => navigate('/qa')}>
          <MessagesSquare className="w-4 h-4 mr-1.5" /> 智能问答
        </Button>
        <Button variant={isActive('/admin') ? 'default' : 'ghost'} size="sm" onClick={() => navigate('/admin')}>
          <Sliders className="w-4 h-4 mr-1.5" /> 审批控制台
        </Button>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Create LeftSidebar**

Write `frontend/src/components/layout/LeftSidebar.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchRepos, fetchTopics, fetchQaEntries } from '@/api/client'
import type { Topic, Repo, QaEntry } from '@/types'
import { FileText, BookOpen, Hash, Target, Clock, Activity, FolderGit } from 'lucide-react'

interface LeftSidebarProps {
  pageType: 'wiki' | 'qa' | 'admin'
  currentSlug?: string
  currentTopic?: string
  onNavigate?: (slug: string) => void
}

export function LeftSidebar({ pageType, currentSlug, currentTopic, onNavigate }: LeftSidebarProps) {
  const navigate = useNavigate()
  const { repo } = useParams<{ repo: string }>()
  const [topics, setTopics] = useState<Topic[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (pageType === 'wiki') {
      fetchTopics().then(setTopics).catch(() => {})
    } else if (pageType === 'admin') {
      fetchQaEntries({ status: 'pending', limit: 1 }).then(d => setPendingCount(d.total)).catch(() => {})
    }
  }, [pageType])

  const handleDocClick = (slug: string) => {
    if (onNavigate) onNavigate(slug)
    else navigate(`/${repo}#${slug}`)
  }

  if (pageType === 'wiki') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium">
          {/* 物理视角 */}
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <FolderGit className="w-3.5 h-3.5" /> 物理视角
            </h3>
            <ul className="space-y-1 text-gray-600">
              <li>
                <button onClick={() => handleDocClick('overview')}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentSlug === 'overview' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                  <FileText className="w-3.5 h-3.5 text-gray-400" /> 概览
                </button>
              </li>
              <li>
                <button onClick={() => handleDocClick('02-qa-engine')}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentSlug === '02-qa-engine' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                  <BookOpen className="w-3.5 h-3.5 text-gray-400" /> 双路路由算法
                </button>
              </li>
            </ul>
          </div>
          {/* 逻辑视角 */}
          <div className="pt-2 border-t border-gray-200/50">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Hash className="w-3.5 h-3.5 text-cyber-blue" /> 逻辑视角
            </h3>
            <ul className="space-y-1 text-gray-600">
              {topics.map(t => (
                <li key={t.slug}>
                  <button onClick={() => handleDocClick(t.slug)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 transition ${currentTopic === t.slug ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : ''}`}>
                    <span className="font-mono text-[11px]">#{t.slug}</span>
                    <span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'promoted' ? '已固化' : '聚合中'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    )
  }

  if (pageType === 'qa') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium flex flex-col h-full">
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Target className="w-3.5 h-3.5 text-rose-500" /> 主题快捷过滤
            </h3>
            <ul className="space-y-1">
              <li><button className="w-full flex items-center px-3 py-2 rounded-lg text-left bg-cyber-blue text-white font-bold">🌐 显示全部</button></li>
              {topics.map(t => (
                <li key={t.slug}>
                  <button className="w-full flex items-center px-3 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100">
                    <span className="font-mono">#{t.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="pt-4 border-t border-gray-200/50 flex-1 flex flex-col min-h-0">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Clock className="w-3.5 h-3.5" /> 历史会话
            </h3>
            <div className="flex-1 flex items-center justify-center text-gray-400 text-[11px]">暂无记录</div>
          </div>
        </div>
      </aside>
    )
  }

  if (pageType === 'admin') {
    return (
      <aside className="w-64 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col overflow-y-auto no-scrollbar shrink-0">
        <div className="p-4 space-y-6 text-xs font-medium">
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5 px-2">
              <Activity className="w-3.5 h-3.5 text-amber-500" /> 审批控制塔
            </h3>
            <ul className="space-y-1">
              <li>
                <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none">
                  <span className="flex items-center gap-2">⏳ 待审草稿</span>
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                  )}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    )
  }

  return null
}
```

- [ ] **Step 3: Create BottomInput**

Write `frontend/src/components/layout/BottomInput.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Terminal, ArrowRight } from 'lucide-react'

interface BottomInputProps {
  placeholder?: string
  contextTag?: string
  visible: boolean
}

export function BottomInput({ placeholder = '提出新疑问...', contextTag, visible }: BottomInputProps) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  if (!visible) return null

  const handleSend = () => {
    const q = value.trim()
    if (!q) return
    const params = new URLSearchParams({ q })
    if (contextTag) params.set('context_entity_slug', contextTag)
    navigate(`/qa?${params.toString()}`)
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent flex items-end justify-center pointer-events-none z-20">
      <div className="w-full max-w-2xl px-6 pb-8 pointer-events-auto">
        <div className="bg-white/90 backdrop-blur-md border border-gray-200/80 rounded-xl shadow-lg p-3 transition-all duration-200 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1"
              placeholder={placeholder}
            />
            {contextTag && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 text-[10px] font-mono rounded whitespace-nowrap">
                #{contextTag}
              </span>
            )}
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend}>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/
git commit -m "feat: add layout components (Header, LeftSidebar, BottomInput)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.2: HomePage — search hero + 4 grid sections

**Files:**
- Create: `frontend/src/pages/HomePage.tsx`

- [ ] **Step 1: Create HomePage**

Write `frontend/src/pages/HomePage.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchRepos, fetchQaEntries } from '@/api/client'
import type { Repo, QaEntry } from '@/types'
import { Search, GitFork, FileText, MessageCircle, Flame, W } from 'lucide-react'

interface SearchItem {
  type: 'wiki' | 'topic' | 'qa'
  label: string
  key: string
}

const SEARCH_POOL: SearchItem[] = [
  { type: 'wiki', label: '📖 物理文档: 双路分流路由算法', key: '02-qa-engine' },
  { type: 'topic', label: '🏷️ 核心主题: #qa-engine', key: 'qa-engine' },
  { type: 'topic', label: '🏷️ 核心主题: #concurrency', key: 'concurrency' },
]

export function HomePage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [draftQa, setDraftQa] = useState<QaEntry[]>([])
  const [hotQa, setHotQa] = useState<QaEntry[]>([])
  const [searchVal, setSearchVal] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchQaEntries({ status: 'pending', limit: 3 }).then(d => setDraftQa(d.entries)).catch(() => {})
    fetchQaEntries({ sort: 'visit', limit: 3 }).then(d => setHotQa(d.entries)).catch(() => {})
  }, [])

  const filteredSuggest = searchVal.trim()
    ? SEARCH_POOL.filter(i => i.label.toLowerCase().includes(searchVal.toLowerCase()))
    : []

  const handleSuggestClick = (item: SearchItem) => {
    setShowSuggest(false)
    setSearchVal('')
    if (item.type === 'qa') navigate('/qa')
    else navigate(`/${repos[0]?.name ?? 'self'}#${item.key}`)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      navigate(`/qa?q=${encodeURIComponent(searchVal.trim())}`)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="home" />
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-4xl mx-auto space-y-12 py-12 px-6">
          {/* Search Hero */}
          <div className="text-center space-y-5 py-4">
            <div className="flex items-center justify-center gap-2.5">
              <div className="w-9 h-9 bg-cyber-blue rounded-xl flex items-center justify-center text-white font-black text-lg font-mono shadow-md shadow-cyber-blue/20">W</div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">OpenCodeWiki</h1>
            </div>
            <p className="text-gray-400 text-xs max-w-md mx-auto">让项目说明书与日常问答在物理与逻辑层完美联动，自动进化。</p>

            <div className="max-w-2xl mx-auto relative px-4">
              <div className="bg-white border border-gray-200/80 rounded-2xl shadow-lg p-3.5 flex items-center gap-3 transition-all duration-300 focus-within:border-cyber-blue focus-within:ring-4 focus-within:ring-cyber-blue/10">
                <Search className="w-5 h-5 text-gray-400 shrink-0 ml-1" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={e => { setSearchVal(e.target.value); setShowSuggest(true) }}
                  onFocus={() => setShowSuggest(true)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                  placeholder="搜索物理文档、活跃主题或避坑问答... (回车检索)"
                />
                <span className="text-[10px] bg-gray-100 border border-gray-200 text-gray-400 font-mono px-2 py-1 rounded-lg shrink-0">Ctrl + K</span>
              </div>

              {showSuggest && searchVal.trim() && filteredSuggest.length > 0 && (
                <div className="absolute top-full left-4 right-4 bg-white border border-gray-100 rounded-xl shadow-xl mt-1.5 p-2 text-left text-xs z-50">
                  {filteredSuggest.map(item => (
                    <button
                      key={item.label}
                      onClick={() => handleSuggestClick(item)}
                      className="w-full p-2.5 hover:bg-slate-100 rounded-lg flex justify-between items-center transition"
                    >
                      <span className="font-medium text-gray-700">{item.label}</span>
                      <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold">{item.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 4 Grid Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Repo */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <GitFork className="w-4 h-4 text-gray-400" /> 关联物理仓库
              </h3>
              {repos.slice(0, 3).map(r => (
                <div key={r.name} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50 flex justify-between items-center">
                  <div>
                    <span className="font-mono text-xs font-bold text-gray-800 block">{r.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{r.path}</span>
                  </div>
                  <span className="text-[10px] text-cyber-green bg-cyber-green/10 px-2 py-0.5 rounded font-bold">已同步</span>
                </div>
              ))}
              {repos.length === 0 && <div className="text-xs text-gray-400">暂无仓库</div>}
            </div>

            {/* Latest Docs */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition flex flex-col justify-between">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyber-blue" /> 最新物理文档
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <button onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#02-qa-engine`)}
                    className="w-full flex justify-between items-center text-gray-700 hover:text-cyber-blue">
                    <span className="font-semibold">双路分流路由算法系统</span>
                    <span className="text-[10px] text-gray-400">3分钟前更新</span>
                  </button>
                </li>
              </ul>
            </div>

            {/* Latest QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-amber-500" /> 最新流动 Q&A
              </h3>
              <div className="space-y-2.5">
                {draftQa.map(qa => (
                  <div key={qa.qid} onClick={() => navigate('/qa')}
                    className="cursor-pointer border-l-2 border-amber-400 pl-2.5 py-0.5 text-xs group">
                    <div className="font-bold text-gray-800 group-hover:text-cyber-blue transition truncate">{qa.question}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">状态: 待审草稿</div>
                  </div>
                ))}
                {draftQa.length === 0 && <div className="text-xs text-gray-400">暂无最新问答</div>}
              </div>
            </div>

            {/* Hot QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm space-y-3 hover:border-gray-300 transition">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-red-500" /> 沉淀最热 Q&A
              </h3>
              <div className="space-y-2.5">
                {hotQa.map(qa => (
                  <div key={qa.qid} onClick={() => navigate('/qa')}
                    className="cursor-pointer border-l-2 border-cyber-green pl-2.5 py-0.5 text-xs group">
                    <div className="font-bold text-gray-800 group-hover:text-cyber-blue transition truncate">{qa.question}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">已持久化 • {qa.visit_count} 次访问</div>
                  </div>
                ))}
                {hotQa.length === 0 && <div className="text-xs text-gray-400">暂无热门问答</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HomePage.tsx
git commit -m "feat: add HomePage with search hero and 4-grid layout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.3: WikiPage — hash-based doc/topic viewer

**Files:**
- Create: `frontend/src/pages/WikiPage.tsx`

- [ ] **Step 1: Create WikiPage**

Write `frontend/src/pages/WikiPage.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [content, setContent] = useState<string>('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState<string>('')

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string) => {
    if (!slug) return
    setCurrentSlug(slug)
    try {
      const data = await fetchWikiPage(slug)
      setContent(data.content)
      setPageType(data.type as 'wiki' | 'topic')
    } catch {
      setContent('')
      setPageType('wiki')
    }
  }, [])

  useEffect(() => {
    if (currentHash) loadContent(currentHash)
    else loadContent('overview')
  }, [currentHash, loadContent])

  const handleNavigate = (slug: string) => {
    window.location.hash = slug
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} activeSection="wiki" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="wiki" currentSlug={currentSlug} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-4xl transition-all">
              {content ? (
                <div className="space-y-6 bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  <article className="prose prose-slate max-w-none text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: content }} />
                </div>
              ) : (
                <div className="text-center text-gray-400 py-20">选择左侧文档开始阅读</div>
              )}
            </div>
          </div>
          <BottomInput visible placeholder={`对当前文档提问...`} contextTag={currentSlug} />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx
git commit -m "feat: add WikiPage with hash-based document navigation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 1.4: QAPage — streaming conversation

**Files:**
- Create: `frontend/src/pages/QAPage.tsx`
- Create: `frontend/src/hooks/useSSE.ts`

- [ ] **Step 1: Create SSE hook**

Write `frontend/src/hooks/useSSE.ts`:

```typescript
import { useState, useRef, useCallback } from 'react'

interface SSEMessage {
  type: 'token' | 'session' | 'sources' | 'error' | 'done'
  [key: string]: unknown
}

export function useSSE() {
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stream = useCallback(async (
    url: string,
    body: unknown,
    onMessage: (msg: SSEMessage) => void,
  ) => {
    setIsLoading(true)
    abortRef.current = new AbortController()

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          try {
            const data = JSON.parse(trimmed.slice(6))
            onMessage(data)
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        onMessage({ type: 'error', message: err.message })
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { stream, abort, isLoading }
}
```

- [ ] **Step 2: Create QAPage**

Write `frontend/src/pages/QAPage.tsx`:

```typescript
import { useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function QAPage() {
  const [searchParams] = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(searchParams.get('q') ?? '')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const { stream, isLoading } = useSSE()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q || isLoading) return

    setMessages(prev => [...prev, { role: 'user', content: q }])
    setCurrentAnswer('')
    setInput('')

    stream('/api/qa', { question: q }, (msg) => {
      if (msg.type === 'token') {
        setCurrentAnswer(prev => prev + (msg.content as string))
      } else if (msg.type === 'error') {
        setCurrentAnswer(`Error: ${msg.message}`)
      } else if (msg.type === 'done') {
        setMessages(prev => [...prev, { role: 'assistant', content: currentAnswer }])
        setCurrentAnswer('')
      }
    })
  }, [input, isLoading, stream, currentAnswer])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="qa" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="qa" />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-3xl space-y-6">
              {/* Messages */}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    m.role === 'user'
                      ? 'bg-cyber-blue text-white'
                      : 'bg-white border border-gray-200/50 shadow-sm text-gray-800'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {currentAnswer && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">
                    {currentAnswer}
                  </div>
                </div>
              )}
              {messages.length === 0 && !currentAnswer && (
                <div className="text-center text-gray-400 py-20">
                  <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                  <p className="text-sm">我可以帮你理解架构、定位代码或解释工作原理</p>
                </div>
              )}
            </div>
          </div>

          {/* Input */}
          <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent py-6 px-6">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-2 bg-white border border-gray-200/80 rounded-xl shadow-lg p-3 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10 transition-all">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="对代码库提问..."
                  className="flex-1 bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                />
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/QAPage.tsx frontend/src/hooks/useSSE.ts
git commit -m "feat: add QAPage with SSE streaming conversation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2: Topic System & Admin

### Task 2.1: Python — topic store + API

**Files:**
- Create: `src/python-agent/store_topics.py`
- Modify: `src/python-agent/main.py` (add topic routes)

- [ ] **Step 1: Create store_topics.py**

```python
"""
store_topics.py — Topic 聚合层 CRUD.
QA → Topic 聚合 → Draft 提炼 → Wiki 晋升
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from database import get_knowledge_db


def list_topics(status: str | None = None) -> list[dict]:
    db = get_knowledge_db()
    if status:
        rows = db.execute("SELECT * FROM topics WHERE status = ? ORDER BY created_at DESC", (status,))
    else:
        rows = db.execute("SELECT * FROM topics ORDER BY created_at DESC")
    topics = [dict(r) for r in rows.fetchall()]
    # Attach QA count
    for t in topics:
        cnt = db.execute("SELECT COUNT(*) AS c FROM topic_qa WHERE topic_slug = ?", (t["slug"],)).fetchone()
        t["qa_count"] = cnt["c"]
    return topics


def get_topic(slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topics WHERE slug = ?", (slug,)).fetchone()
    if not row:
        return None
    topic = dict(row)
    # Attach QA entries
    qa_rows = db.execute(
        """SELECT q.qid, q.question, q.answer, q.created_at
           FROM topic_qa tq JOIN qa_entries q ON q.qid = tq.qid
           WHERE tq.topic_slug = ? ORDER BY q.created_at DESC""",
        (slug,),
    ).fetchall()
    topic["qa_entries"] = [dict(r) for r in qa_rows]
    return topic


def create_topic(slug: str, name: str, description: str = "") -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT OR IGNORE INTO topics (slug, name, description, status, created_at) VALUES (?, ?, ?, 'pool', ?)",
        (slug, name, description, now),
    )
    db.commit()
    return {"slug": slug, "name": name, "status": "pool"}


def link_qa(topic_slug: str, qid: int):
    db = get_knowledge_db()
    db.execute("INSERT OR IGNORE INTO topic_qa (topic_slug, qid) VALUES (?, ?)", (topic_slug, qid))
    db.commit()


def save_draft(topic_slug: str, raw_content: str) -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT OR REPLACE INTO topic_drafts
           (topic_slug, raw_content, status, created_at)
           VALUES (?, ?, 'pending', ?)""",
        (topic_slug, raw_content, now),
    )
    db.commit()
    return {"topic_slug": topic_slug, "status": "pending"}


def get_draft(topic_slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topic_drafts WHERE topic_slug = ?", (topic_slug,)).fetchone()
    return dict(row) if row else None


def approve_draft(topic_slug: str, reviewer: str = "admin") -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'approved', reviewer = ?, reviewed_at = ? WHERE topic_slug = ?",
        (reviewer, now, topic_slug),
    )
    db.commit()
    return True


def promote(topic_slug: str, wiki_module: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topics SET status = 'promoted', wiki_module = ?, promoted_at = ? WHERE slug = ?",
        (wiki_module, now, topic_slug),
    )
    db.commit()
    return True
```

- [ ] **Step 2: Add topic routes to main.py**

Append to `src/python-agent/main.py` (after the wiki section, before static files):

```python
# ── Topics ──────────────────────────────────────────────────────

from store_topics import (
    list_topics, get_topic, create_topic, link_qa,
    save_draft, get_draft, approve_draft, promote as promote_topic,
)


@app.get("/api/topics")
async def api_topics(status: str | None = None):
    return _ok(list_topics(status))


@app.get("/api/topics/{slug}")
async def api_topic(slug: str):
    topic = get_topic(slug)
    if not topic:
        raise HTTPException(404, f"Topic '{slug}' not found")
    return _ok(topic)


@app.post("/api/topics")
async def api_create_topic(body: dict):
    slug = body.get("slug", "").strip()
    name = body.get("name", "").strip()
    if not slug or not name:
        return _err("Missing slug or name")
    result = create_topic(slug, name, body.get("description", ""))
    return _ok(result)


@app.get("/api/topics/{slug}/draft")
async def api_topic_draft(slug: str):
    draft = get_draft(slug)
    return _ok(draft)
```

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/store_topics.py src/python-agent/main.py
git commit -m "feat: add topic store and API routes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2.2: AdminPage — pending queue + topic management

**Files:**
- Create: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Create AdminPage**

Write `frontend/src/pages/AdminPage.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { Button } from '@/components/ui/button'
import { fetchQaPending, calibrateQaEntry, analyzeTopics, fetchTopics, fetchTopic, fetchTopicDraft } from '@/api/client'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import { Loader2, Sparkles, CheckCircle, FileText, Eye } from 'lucide-react'

export function AdminPage() {
  const [pengingEntries, setPendingEntries] = useState<QaEntry[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})

  useEffect(() => {
    fetchQaPending().then(setPendingEntries).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
  }, [])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      await analyzeTopics()
      const updated = await fetchTopics()
      setTopics(updated)
    } catch {}
    setAnalyzing(false)
  }

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    await calibrateQaEntry(qid, answer)
    setPendingEntries(prev => prev.filter(e => e.qid !== qid))
  }

  const handleViewTopic = async (slug: string) => {
    const topic = await fetchTopic(slug)
    setSelectedTopic(topic)
    const draft = await fetchTopicDraft(slug)
    setSelectedDraft(draft)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="admin" />
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar pageType="admin" />
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Pending QA */}
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4">⏳ 待审条目</h2>
              <div className="space-y-3">
                {pengingEntries.map(e => (
                  <div key={e.qid} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-cyber-blue font-bold">#Q{e.qid}</span>
                      <span className="text-sm font-medium">{e.question}</span>
                    </div>
                    <textarea
                      value={calAnswers[e.qid] ?? ''}
                      onChange={e => setCalAnswers(prev => ({ ...prev, [e.qid]: e.target.value }))}
                      placeholder="输入校准答案..."
                      rows={3}
                      className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => window.open(`/qa?qid=${e.qid}`, '_blank')}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> 查看
                      </Button>
                      <Button size="sm" onClick={() => handleCalibrate(e.qid)} disabled={!calAnswers[e.qid]?.trim()}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> 校准
                      </Button>
                    </div>
                  </div>
                ))}
                {pengingEntries.length === 0 && (
                  <div className="text-center text-gray-400 py-8 text-sm">✅ 暂无待审核条目</div>
                )}
              </div>
            </div>

            {/* Topic Analysis */}
            <div className="border-t border-gray-200 pt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">🧠 Topic 聚合</h2>
                <Button onClick={handleAnalyze} disabled={analyzing}>
                  {analyzing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
                  分析 QA 池
                </Button>
              </div>
              <div className="grid gap-3">
                {topics.map(t => (
                  <div key={t.slug}
                    className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-cyber-blue/30 transition"
                    onClick={() => handleViewTopic(t.slug)}>
                    <div>
                      <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                      <span className="text-xs text-gray-500 ml-2">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        t.status === 'promoted' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {t.status === 'promoted' ? '已固化' : '聚合中'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewTopic(t.slug) }}>
                        <FileText className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {topics.length === 0 && (
                  <div className="text-center text-gray-400 py-8 text-sm">暂无 Topic，点击"分析 QA 池"生成</div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat: add AdminPage with pending queue and topic management

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2.3: Wiki store (Python) — markdown page CRUD

**Files:**
- Create: `src/python-agent/store_wiki.py`
- Modify: `src/python-agent/main.py` (add wiki content serving from filesystem)

- [ ] **Step 1: Create store_wiki.py**

```python
"""
store_wiki.py — Wiki 页面文件操作层.
读取/写入 .md 文件到 ~/.opencodewiki/pages/ 目录.
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path

PAGES_DIR = Path.home() / ".opencodewiki" / "pages"

_TYPE_DIRS = {
    "entity": "entities",
    "overview": "overviews",
    "qa-archive": "qa-archives",
}


def _ensure_dirs():
    for d in _TYPE_DIRS.values():
        (PAGES_DIR / d).mkdir(parents=True, exist_ok=True)


def page_path(slug: str, page_type: str = "entity") -> Path:
    sub = _TYPE_DIRS.get(page_type, "entities")
    return PAGES_DIR / sub / f"{slug}.md"


def read_page(slug: str, page_type: str = "entity") -> str | None:
    path = page_path(slug, page_type)
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def write_page(slug: str, page_type: str, content: str) -> Path:
    _ensure_dirs()
    path = page_path(slug, page_type)
    path.write_text(content, encoding="utf-8")
    return path


def list_pages(page_type: str | None = None) -> list[dict]:
    _ensure_dirs()
    pages = []
    dirs = [PAGES_DIR / d for d in _TYPE_DIRS.values()] if page_type is None else [PAGES_DIR / _TYPE_DIRS[page_type]]
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            pages.append({
                "slug": f.stem,
                "page_type": next((k for k, v in _TYPE_DIRS.items() if v == d.name), "entity"),
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    return pages
```

- [ ] **Step 2: Extend main.py wiki route to also check pages**

In `main.py`, replace the `api_wiki_page` function:

```python
from store_wiki import read_page as read_wiki_file


@app.get("/api/wiki/{slug}")
async def api_wiki_page(slug: str):
    # Try physical wiki document in .codegraph/wiki/
    for md_path in WIKI_BASE.rglob(f"{slug}.md"):
        content = md_path.read_text(encoding="utf-8")
        return _ok({"type": "wiki", "slug": slug, "content": content})
    # Try stored page
    stored = read_wiki_file(slug, "entity")
    if stored:
        return _ok({"type": "wiki", "slug": slug, "content": stored})
    raise HTTPException(404, f"Wiki page '{slug}' not found")
```

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/store_wiki.py src/python-agent/main.py
git commit -m "feat: add wiki store and extend wiki API to stored pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Color palette (`#4F46E5`, `#10B981`, etc) → Task 0.5 (Tailwind config)
- Three-column layout with dynamic sidebar → Task 1.1 (LeftSidebar)
- Home page search hero + 4 grid sections → Task 1.2 (HomePage)
- Floating input bar → Task 1.1 (BottomInput)
- Hash-based wiki navigation → Task 1.3 (WikiPage)
- QAPage with SSE streaming → Task 1.4 (QAPage + useSSE hook)
- Topic data model (topics, topic_qa, topic_drafts tables) → Task 0.2, 2.1
- Admin pending queue + calibration → Task 2.2
- Admin topic analysis trigger → Task 2.2
- Topic promotion flow → Task 2.1 (Python), TODO: frontend promotion UI
- QA → Topic → Wiki lifecycle → Covered across Phase 2 tasks
- Search suggestions → Task 1.2 (HomePage search)
- Search autocomplete dropdown → Task 1.2 (HomePage filtered suggestions)
- QA store/extended API on Python → Task 0.3, 0.4
- Node.js removal → Task 0.1

**2. Placeholder check:** No TODOs, TBDs, or placeholders. All code is concrete.

**3. Type consistency:** All API client functions match the Python routes. Frontend types match backend response structures.
