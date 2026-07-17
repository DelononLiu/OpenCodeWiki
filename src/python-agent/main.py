"""
FastAPI 入口：全栈 OpenCodeWiki 后端。

提供 REST API + SSE 流式 QA + 静态文件服务 (React SPA build)。
"""

import json
import os
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

sys.path.insert(0, str(HERE))


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


# ── QA ──────────────────────────────────────────────────────────

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
    if WIKI_BASE.exists():
        for md_path in WIKI_BASE.rglob(f"{slug}.md"):
            content = md_path.read_text(encoding="utf-8")
            return _ok({"type": "wiki", "slug": slug, "content": content})
    # Try stored page
    try:
        from store_wiki import read_page as read_wiki_file
        stored = read_wiki_file(slug, "entity")
        if stored:
            return _ok({"type": "wiki", "slug": slug, "content": stored})
    except ImportError:
        pass
    raise HTTPException(404, f"Page '{slug}' not found")


# ── Topics ──────────────────────────────────────────────────────

try:
    from store_topics import (
        list_topics, get_topic, create_topic, get_draft,
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

except ImportError:
    pass


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
