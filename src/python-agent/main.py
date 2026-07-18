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


# ── Settings ───────────────────────────────────────────────────

CONFIG_PATH = Path.home() / ".opencodewiki" / "config.json"

DEFAULT_CONFIG = {
    "general": {"site_name": "OpenCodeWiki"},
    "model": {"provider": "openai", "api_key": "", "model": "gpt-4o", "temperature": 0.7},
}

def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULT_CONFIG

def _save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2))


@app.get("/api/settings")
async def api_settings():
    return _ok(_load_config())


@app.put("/api/settings")
async def api_settings_update(body: dict):
    section = body.get("section", "")
    data = body.get("data", {})
    if section not in ("general", "model"):
        return _err("Invalid section, must be 'general' or 'model'")
    config = _load_config()
    config[section] = data
    _save_config(config)
    return _ok({"saved": True})


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
    # Try physical wiki document in .codegraph/wiki/
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
    # Try topic
    try:
        from store_topics import get_topic as get_topic_data
        topic = get_topic_data(slug)
        if topic:
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)

            wiki_links = []
            wiki_module = topic.get("wiki_module")
            if wiki_module:
                wiki_links.append({"slug": wiki_module, "name": wiki_module})

            return _ok({
                "type": "topic",
                "slug": slug,
                "content": content,
                "topic": {
                    "name": topic["name"],
                    "description": topic.get("description", ""),
                    "status": topic.get("status", "pool"),
                    "wiki_module": topic.get("wiki_module"),
                },
                "qa_entries": [
                    {"qid": q["qid"], "question": q["question"], "created_at": q.get("created_at", "")}
                    for q in qa_list[:20]
                ],
                "wiki_links": wiki_links,
            })
    except ImportError:
        pass
    raise HTTPException(404, f"Page '{slug}' not found")


@app.get("/api/wiki/modules")
async def api_wiki_modules():
    """返回 wiki 模块目录列表（供 Admin 选择沉淀位置）"""
    modules = []
    if WIKI_BASE.exists():
        for child in sorted(WIKI_BASE.iterdir()):
            if child.is_dir():
                modules.append({"slug": child.name, "name": child.name, "type": "directory"})
            elif child.name.endswith(".md"):
                modules.append({"slug": child.stem, "name": child.stem, "type": "page"})
    # Also list stored pages
    try:
        from store_wiki import list_pages
        stored = list_pages()
        for p in stored:
            if not any(m["slug"] == p["slug"] for m in modules):
                modules.append({"slug": p["slug"], "name": p["slug"], "type": p["page_type"]})
    except ImportError:
        pass
    return _ok(modules)


# ── Topics ──────────────────────────────────────────────────────

try:
    from store_topics import (
        list_topics, get_topic, create_topic, get_draft,
        save_draft, link_qa, update_draft_content, publish as publish_topic,
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

    @app.post("/api/topics/{slug}/draft")
    async def api_save_draft(slug: str, body: dict):
        content = body.get("content", "").strip()
        if not content:
            return _err("Missing content")
        result = save_draft(slug, content)
        return _ok(result)

    @app.put("/api/topics/{slug}/draft")
    async def api_edit_draft(slug: str, body: dict):
        content = body.get("content", "").strip()
        if not content:
            return _err("Missing content")
        update_draft_content(slug, content)
        return _ok({"updated": True})

    @app.post("/api/topics/analyze")
    async def api_analyze_topics():
        """分析 QA 池，按 domain/tag 聚类生成 topic 建议"""
        from store_qa import list_entries

        result = list_entries({"status": "active", "limit": 100})
        entries = result.get("entries", [])

        # 按 domain 分组
        groups: dict = {}
        for e in entries:
            dom = e.get("domain", "general")
            if dom not in groups:
                groups[dom] = []
            groups[dom].append(e)

        suggestions = []
        for domain, items in groups.items():
            if len(items) < 2:
                continue
            slug = domain.replace("_", "-").replace(" ", "-")
            name = {"general": "通用实践", "bug-analysis": "缺陷分析",
                    "log-analysis": "日志分析", "stack-analysis": "堆栈分析",
                    "build-issue": "编译构建", "program-analysis": "程序分析"}.get(domain, domain)
            # 创建或更新 topic
            topic = create_topic(slug, name, f"从 {len(items)} 条 {name} QA 自动聚合")
            for item in items:
                link_qa(slug, item["qid"])
            suggestions.append(topic)

        return _ok({"suggestions": suggestions, "total": len(suggestions)})

    @app.post("/api/topics/{slug}/publish")
    async def api_publish_topic(slug: str, body: dict):
        """沉淀 topic 为 wiki 页面"""
        wiki_module = body.get("wiki_module", "").strip()
        if not wiki_module:
            return _err("Missing wiki_module")

        topic = get_topic(slug)
        if not topic:
            raise HTTPException(404, f"Topic '{slug}' not found")

        # 获取提炼稿内容，优先用编辑过的版本
        draft = get_draft(slug)
        content = None
        if draft:
            content = draft.get("edited_content") or draft.get("raw_content")

        if not content:
            # 从关联 QA 自动生成 markdown
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)

        # 写入 wiki 目录
        from store_wiki import write_page
        write_page(slug, "entity", content)

        # 更新 topic 状态
        publish_topic(slug, wiki_module)

        return _ok({"slug": slug, "wiki_module": wiki_module, "published": True})

except ImportError:
    pass


# ── QA Save ──────────────────────────────────────────────────────

DOMAINS = ['bug-analysis', 'log-analysis', 'program-analysis', 'build-issue', 'stack-analysis', 'general']


async def classify_domain(question: str, answer: str) -> str:
    try:
        from langchain_openai import ChatOpenAI
        from config import get_llm_config
        llm = ChatOpenAI(**get_llm_config(), temperature=0)
        text = f"{question[:300]}\n{answer[:500]}"
        resp = await llm.ainvoke(
            f"将以下问答分类到以下类别之一: {', '.join(DOMAINS)}。只输出类别名，不要解释。\n\n{text}"
        )
        domain = resp.content.strip()
        return domain if domain in DOMAINS else 'general'
    except Exception:
        return 'general'


@app.post("/api/qa/save")
async def api_qa_save(body: dict):
    question = body.get("question", "").strip()
    answer = body.get("answer", "").strip()
    if not question or not answer:
        return _err("Missing question or answer")
    entry = create_entry({
        "question": question,
        "answer": answer,
        "repo": body.get("repo", ""),
        "sessionId": body.get("session_id", ""),
        "mode": body.get("mode", "deep"),
        "sources": body.get("sources", []),
    })
    domain = await classify_domain(question, answer)
    from store_qa import update_domain
    update_domain(entry["qid"], domain)
    return _ok({"qid": entry["qid"], "id": entry["id"], "domain": domain})


# ── Global Search ───────────────────────────────────────────────

@app.get("/api/search")
async def api_search(q: str = "", limit: int = 10):
    if len(q.strip()) < 2:
        return _ok({"wiki": [], "topic": [], "qa": []})

    # 搜 wiki
    wiki_results = []
    if WIKI_BASE.exists():
        for md_path in WIKI_BASE.rglob("*.md"):
            if len(wiki_results) >= 3:
                break
            try:
                content = md_path.read_text(encoding="utf-8")[:500]
                title = md_path.stem
            except Exception:
                continue
            if q.lower() in title.lower() or q.lower() in content.lower():
                wiki_results.append({
                    "slug": title,
                    "title": title,
                    "snippet": content[:120],
                })

    # 搜 topic
    topic_results = []
    try:
        from store_topics import search_topics
        topic_results = search_topics(q, limit=3)
    except ImportError:
        pass

    # 搜 QA
    qa_results = []
    try:
        from store_qa import search_questions
        qa_results = search_questions(q, limit=3)
    except ImportError:
        pass

    return _ok({"wiki": wiki_results, "topic": topic_results, "qa": qa_results})


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
