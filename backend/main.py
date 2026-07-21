"""
FastAPI 入口：全栈 OpenCodeWiki 后端。

提供 REST API + SSE 流式 QA + 静态文件服务 (React SPA build)。
"""

import json
import logging
import os
import subprocess
import sys
import uuid
from pathlib import Path

# ── 日志 ──
LOG_DIR = Path.home() / ".opencodewiki"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(str(LOG_DIR / "app.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("opencodewiki")
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncio

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from database import init_databases
from stores.qa import (
    calibrate as calibrate_entry,
    create_entry,
    get_entry,
    get_next_qid,
    list_entries,
    list_pending,
    search_questions,
)
from stores.sources import (
    list_sources as get_sources,
    get_source as get_source_entry,
)
from source_importer import (
    import_code_git, import_code_zip,
    import_docs_git, import_docs_zip,
    sync_source, remove_source,
)

# ── Config ──────────────────────────────────────────────────────

HERE = Path(__file__).parent
ROOT = HERE.parent
FRONTEND_DIST = ROOT / "frontend" / "dist"
REGISTRY_PATH = Path.home() / ".opencodewiki" / "registry.json"

sys.path.insert(0, str(HERE))


def _load_registry() -> list[dict]:
    return get_sources()


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
    return _ok(get_sources("code"))


# ── Sources ──────────────────────────────────────────────────────

@app.get("/api/sources")
async def api_sources(type: str | None = None):
    sources = get_sources(type)
    # 对 code 源追加当前版本号（只读本地 .git，毫秒级）
    for src in sources:
        if src.get("type") == "code":
            repo_path = KNOWLEDGE_DIR / src["name"]
            git_dir = repo_path / ".git"
            if git_dir.exists():
                try:
                    r = subprocess.run(["git", "log", "--oneline", "-1"], cwd=repo_path, capture_output=True, text=True, timeout=5)
                    if r.returncode == 0:
                        src["git_commit"] = r.stdout.strip()
                except Exception:
                    pass
    return _ok(sources)


@app.get("/api/sources/{name}")
async def api_source(name: str):
    src = get_source_entry(name)
    if not src:
        raise HTTPException(404, f"Source '{name}' not found")
    # 对 code 类型的源，追加 git 版本信息
    if src.get("type") == "code":
        repo_path = KNOWLEDGE_DIR / name
        if repo_path.exists():
            try:
                import subprocess
                head = subprocess.run(["git", "log", "--oneline", "-1"], cwd=repo_path, capture_output=True, text=True, timeout=5)
                count = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=repo_path, capture_output=True, text=True, timeout=5)
                src["git_commit"] = head.stdout.strip() if head.returncode == 0 else ""
                src["git_count"] = count.stdout.strip() if count.returncode == 0 else ""
            except Exception:
                pass
        src["git_branch"] = "main"
    return _ok(src)


@app.post("/api/sources")
async def api_create_source(body: dict):
    name = (body.get("name") or "").strip()
    url = (body.get("url") or "").strip()
    source_type = body.get("type", "code")
    if not name:
        return _err("Missing name")
    if get_source_entry(name):
        return _err(f"Source '{name}' already exists")
    try:
        if source_type == "code":
            result = await import_code_git(name, url)
        elif source_type == "docs":
            result = await import_docs_git(name, url)
        elif source_type == "svn":
            svn_url = (body.get("svn_url") or url or "").strip()
            if not svn_url:
                return _err("Missing svn_url for SVN source")
            username = (body.get("username") or "").strip()
            password = (body.get("password") or "").strip()
            encrypted = ""
            if password:
                from utils.crypto import encrypt_credential
                encrypted = encrypt_credential(password)
            from stores.sources import create_source as do_create
            result = do_create({
                "name": name,
                "type": "svn",
                "url": svn_url,
                "svn_url": svn_url,
                "username": username,
                "encrypted_password": encrypted,
            })
            # 首次检出
            from stores.sources import svn_checkout, KNOWLEDGE_DIR
            dest = KNOWLEDGE_DIR / name
            svn_checkout(svn_url, dest, username, password)
            return _ok(result)
        else:
            return _err(f"Invalid type: {source_type}")
        return _ok(result)
    except Exception as e:
        return _err(str(e), 500)


@app.post("/api/sources/upload")
async def api_upload_source(
    name: str = Form(...),
    type: str = Form("code"),
    file: UploadFile = File(...),
):
    if not name:
        return _err("Missing name")
    if get_source_entry(name):
        return _err(f"Source '{name}' already exists")
    zip_path = Path.home() / ".opencodewiki" / "tmp" / f"{name}.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    zip_path.write_bytes(content)
    try:
        if type == "code":
            result = await import_code_zip(name, zip_path)
        elif type == "docs":
            result = await import_docs_zip(name, zip_path)
        else:
            return _err(f"Invalid type: {type}")
        return _ok(result)
    except Exception as e:
        return _err(str(e), 500)
    finally:
        zip_path.unlink(missing_ok=True)


@app.post("/api/sources/{name}/sync")
async def api_sync_source(name: str):
    from stores.sources import get_source, svn_checkout, KNOWLEDGE_DIR
    src = get_source(name)
    if not src:
        raise HTTPException(404, f"Source '{name}' not found")

    if src.get("type") == "svn":
        svn_url = src.get("svn_url") or src.get("url", "")
        if not svn_url:
            return _err("SVN source has no URL")
        username = src.get("username", "")
        password = ""
        encrypted = src.get("encrypted_password", "")
        if encrypted:
            from utils.crypto import decrypt_credential
            password = decrypt_credential(encrypted)
        dest = KNOWLEDGE_DIR / name
        # 清理旧目录重新检出
        import shutil
        if dest.exists():
            shutil.rmtree(dest)
        svn_checkout(svn_url, dest, username, password)
        from stores.sources import update_source
        update_source(name, {"updated_at": datetime.now(timezone.utc).isoformat()})
        return _ok(get_source(name))
    else:
        try:
            result = await sync_source(name)
            return _ok(result)
        except ValueError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:
            return _err(str(e), 500)


@app.delete("/api/sources/{name}")
async def api_delete_source(name: str):
    ok = await remove_source(name)
    if not ok:
        raise HTTPException(404, f"Source '{name}' not found")
    return _ok({"deleted": True})


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


# ── Documents ──────────────────────────────────────────────────

from stores.sources import KNOWLEDGE_DIR
KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".md", ".txt", ".zip"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def _extract_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext in (".md", ".txt"):
        return content.decode("utf-8", errors="replace")
    return ""


@app.get("/api/documents")
async def api_documents():
    """列出所有知识库下的上传文档。"""
    from datetime import datetime, timezone
    docs = []
    if KNOWLEDGE_DIR.exists():
        for kb_dir in sorted(KNOWLEDGE_DIR.iterdir()):
            if not kb_dir.is_dir():
                continue
            for md_path in sorted(kb_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
                docs.append({
                    "slug": md_path.stem,
                    "kb_name": kb_dir.name,
                    "filename": md_path.name,
                    "size": md_path.stat().st_size,
                    "updated_at": datetime.fromtimestamp(md_path.stat().st_mtime, tz=timezone.utc).isoformat(),
                })
    return _ok(docs)


@app.delete("/api/documents/{slug}")
async def api_delete_document(slug: str):
    """删除已上传的文档文件（在所有知识库目录下搜索）。"""
    if KNOWLEDGE_DIR.exists():
        for kb_dir in KNOWLEDGE_DIR.iterdir():
            if not kb_dir.is_dir():
                continue
            md_path = kb_dir / f"{slug}.md"
            if md_path.exists():
                md_path.unlink()
                return _ok({"deleted": True, "kb_name": kb_dir.name})
    raise HTTPException(404, f"Document '{slug}' not found")


@app.post("/api/documents/upload")
async def api_document_upload(
    file: UploadFile = File(...),
    name: str = Form(""),
    tags: str = Form(""),
):
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return _err(f"不支持的文件类型: {ext}，仅支持 {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return _err(f"文件过大，最大 50MB")

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    kb_name = name.strip()

    # ── zip 解压处理 ──
    if ext == ".zip":
        import io, zipfile
        try:
            zf = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            return _err("无效的 zip 文件")

        kb_name = kb_name or Path(filename).stem

        # 收集所有 .md/.txt 文件条目
        file_entries = [
            e for e in zf.namelist()
            if Path(e).suffix.lower() in (".md", ".txt") and not e.endswith("/")
        ]
        if not file_entries:
            return _err("zip 中未找到 .md 或 .txt 文件")

        # 计算公共前缀（处理顶层目录如 testttt/）
        prefix = Path(file_entries[0]).parent
        for e in file_entries[1:]:
            p = Path(e).parent
            # 逐级缩减到公共部分
            while prefix and not str(p).startswith(str(prefix)):
                prefix = prefix.parent
        prefix_str = str(prefix) + "/" if str(prefix) not in ("", ".") else ""

        uploaded = []
        from datetime import datetime, timezone
        for entry in file_entries:
            try:
                text = zf.read(entry).decode("utf-8", errors="replace")
            except Exception:
                continue
            # strip common prefix + extension → relative slug like "test1/kcode/data-models"
            rel = entry
            if prefix_str:
                rel = entry[len(prefix_str):]
            slug = str(Path(rel).with_suffix(''))
            now = datetime.now(timezone.utc).isoformat()
            header = f"---\nsource: zip_upload\noriginal_filename: {Path(entry).name}\ntags: {', '.join(tag_list)}\nuploaded_at: {now}\n---\n\n"
            kb_dir = KNOWLEDGE_DIR / kb_name
            kb_dir.mkdir(parents=True, exist_ok=True)
            md_path = kb_dir / f"{slug}.md"
            md_path.parent.mkdir(parents=True, exist_ok=True)
            md_path.write_text(header + text, encoding="utf-8")
            uploaded.append({
                "slug": slug,
                "title": Path(slug).name,
                "kb_name": kb_name,
                "filename": Path(entry).name,
                "size": len(text.encode("utf-8")),
            })

        return _ok({"uploaded": uploaded, "total": len(uploaded)})

    # ── 单文件上传（原有逻辑）──
    text = _extract_text(filename, content)
    slug = Path(filename).stem
    kb_name = kb_name or slug

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    header = f"---\nsource: upload\noriginal_filename: {filename}\ntags: {', '.join(tag_list)}\nuploaded_at: {now}\n---\n\n"
    kb_dir = KNOWLEDGE_DIR / kb_name
    kb_dir.mkdir(parents=True, exist_ok=True)
    md_path = kb_dir / f"{slug}.md"
    md_path.write_text(header + text, encoding="utf-8")

    return _ok({
        "slug": slug,
        "title": slug,
        "kb_name": kb_name,
        "page_type": "uploaded",
        "size": len(content),
        "tags": tag_list,
    })


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


@app.get("/api/qa/entry/{qid}/followups")
async def api_qa_followups(qid: int):
    from stores.qa import list_followups
    return _ok(list_followups(qid))


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


@app.get("/api/sessions")
async def api_sessions():
    from stores.qa import list_sessions
    return _ok({"sessions": list_sessions()})


@app.get("/api/qa/entry/{qid}/sources")
async def api_qa_sources(qid: int):
    from stores.qa import get_sources
    sources = get_sources(qid)
    return _ok({"sources": sources})


@app.get("/api/qa/entry/{qid}/related")
async def api_qa_related(qid: int):
    from stores.qa import get_related
    return _ok({"related": get_related(qid)})


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


@app.get("/api/qa/share/{qid}")
async def api_qa_share(qid: int):
    """分享 QA 条目：返回纯净的 question + answer + sources。"""
    from stores.qa import get_entry
    entry = get_entry(qid)
    if not entry:
        raise HTTPException(404, f"#Q{qid} not found")
    return JSONResponse({
        "qid": entry["qid"],
        "question": entry["question"],
        "answer": entry.get("answer", ""),
        "sources": entry.get("sources", []),
        "created_at": entry.get("created_at", ""),
        "tags": entry.get("tags", []),
    })


@app.post("/api/qa/entry/{qid}/refine")
async def api_qa_refine(qid: int):
    """用 LLM 精炼 QA 条目的标题和标签。"""
    from stores.qa import refine_title_and_tags
    result = refine_title_and_tags(qid)
    if not result:
        raise HTTPException(404, f"#Q{qid} not found or refinement failed")
    return _ok(result)


# ── QA SSE (Streaming) ────────────────────────────────────────

from langchain_core.messages import HumanMessage, AIMessage
from agent.graph import get_graph


async def _qa_event_stream(question: str, session_id: str, repo: str = "", context: dict | None = None, history: list | None = None) -> AsyncGenerator[str, None]:
    """LangGraph SSE 流式输出"""
    graph = get_graph()

    # 构建历史消息上下文
    prior_messages = []
    if history:
        for m in history:
            role = m.get("role", "")
            content = m.get("content", "")
            if role == "user":
                prior_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                prior_messages.append(AIMessage(content=content))

    # 追问场景 - 问题前缀指引 LLM 基于上文回答
    augmented_question = question
    if prior_messages:
        augmented_question = f"[多轮对话，请基于上文继续回答]\n{question}"

    def _sse(event_type: str, data: dict) -> str:
        return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"

    yield _sse("session", {"id": session_id})

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

    # Inject wiki context as a system message (instead of appending to question)
    if wiki_context:
        prior_messages.insert(0, HumanMessage(content=f"[系统上下文 - 知识库已有沉淀，请参考]\n{wiki_context}"))

    final_answer = ""
    try:
        result = await asyncio.wait_for(
            graph.ainvoke(
                {"question": augmented_question, "project": repo, "intent": "", "messages": prior_messages},
                config={"configurable": {"thread_id": session_id}},
            ),
            timeout=120,
        )
        for m in result.get("messages", []):
            role = getattr(m, "type", "") or getattr(m, "role", "")
            if role in ("ai", "assistant") and hasattr(m, "content") and m.content:
                final_answer += m.content

        sources = result.get("sources", [])
        if sources:
            yield _sse("sources", {"sources": sources})

        if final_answer:
            yield _sse("token", {"content": final_answer})
        else:
            yield _sse("error", {"message": "Agent did not produce an answer"})
    except asyncio.TimeoutError:
        yield _sse("error", {"message": "搜索超时，请简化问题重试"})
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
    context = body.get("context")
    history_messages = body.get("messages") or []

    if not question:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'message': 'Missing question'})}\n\n"]),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        _qa_event_stream(question, session_id, repo, context, history_messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ── Knowledge bases ────────────────────────────────────────────

@app.get("/api/knowledge")
async def api_knowledge():
    """列出所有知识库（knowledge/ 目录下的文件夹）。"""
    bases = []
    if KNOWLEDGE_DIR.exists():
        for d in sorted(KNOWLEDGE_DIR.iterdir()):
            if d.is_dir() and not d.name.startswith('_'):
                bases.append({"name": d.name})
    return _ok(bases)


# ── Wiki ────────────────────────────────────────────────────────

from stores.sources import KNOWLEDGE_DIR


def _strip_frontmatter(content: str) -> str:
    """移除开头的 YAML frontmatter (---...---) 块（支持连续多个）。"""
    lines = content.strip().split("\n")
    i = 0
    n = len(lines)
    while i < n:
        # 跳过空行
        while i < n and not lines[i].strip():
            i += 1
        if i >= n or lines[i].strip() != "---":
            break
        # 进入 frontmatter 块
        i += 1  # skip opening ---
        while i < n and lines[i].strip() != "---":
            i += 1  # skip frontmatter content
        if i < n:
            i += 1  # skip closing ---
    return "\n".join(lines[i:])


def _extract_h1_from_md(content: str) -> str | None:
    """跳过 YAML frontmatter (---...---)，提取第一个 # 标题。"""
    body = _strip_frontmatter(content)
    for line in body.strip().split("\n"):
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
        if stripped:
            return None
    return None


@app.get("/api/wiki/modules")
async def api_wiki_modules():
    """返回 wiki 模块目录列表（供 Admin 选择沉淀位置）"""
    modules = []
    # List stored pages
    try:
        from stores.wiki import list_pages, read_page
        stored = list_pages()
        for p in stored:
            if not any(m["slug"] == p["slug"] for m in modules):
                title = p["slug"].split("/")[-1]
                try:
                    content = read_page(p["slug"], p["page_type"])
                    if content:
                        h1 = _extract_h1_from_md(content)
                        if h1:
                            title = h1
                except Exception:
                    pass
                modules.append({"slug": p["slug"], "name": title, "type": p["page_type"], "title": title})
    except ImportError:
        pass

    # List all knowledge/ directories as wiki sources
    if KNOWLEDGE_DIR.exists():
        for kb_dir in sorted(KNOWLEDGE_DIR.iterdir()):
            if not kb_dir.is_dir():
                continue
            name = kb_dir.name
            # code 知识库的 wiki 在 openwiki/ 子目录
            md_dirs = [kb_dir] if not (kb_dir / "openwiki").exists() else [kb_dir / "openwiki"]
            for md_dir in md_dirs:
                if not md_dir.exists():
                    continue
                for md_file in sorted(md_dir.rglob("*.md")):
                    # 计算相对 slug（如 "test1/kcode/data-models"）
                    try:
                        rel = md_file.relative_to(md_dir)
                    except ValueError:
                        rel = md_file
                    slug = str(rel.with_suffix('')).replace("\\", "/")
                    if any(m["slug"] == slug for m in modules):
                        continue
                    title = slug.split("/")[-1]
                    try:
                        h1 = _extract_h1_from_md(md_file.read_text(encoding="utf-8"))
                        if h1:
                            title = h1
                    except Exception:
                        pass
                    # 目录层级展示名
                    display_name = f"{name} / {slug}" if "/" in slug else f"{name} / {title}"
                    modules.append({
                        "slug": slug,
                        "name": display_name,
                        "type": "source",
                        "title": title,
                    })
    return _ok(modules)


@app.get("/api/wiki/{slug:path}")
async def api_wiki_page(slug: str):
    """Get wiki page content by slug. Returns markdown or 404."""
    # Try stored page
    try:
        from stores.wiki import read_page as read_wiki_file
        stored = read_wiki_file(slug, "entity")
        if stored:
            return _ok({"type": "wiki", "slug": slug, "content": _strip_frontmatter(stored)})
    except ImportError:
        pass
    # Try topic
    try:
        from stores.topics import get_topic as get_topic_data
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

    # Try all knowledge/ directories
    if KNOWLEDGE_DIR.exists():
        for kb_dir in sorted(KNOWLEDGE_DIR.iterdir()):
            if not kb_dir.is_dir():
                continue
            name = kb_dir.name
            # code 知识库的 wiki 在 openwiki/ 子目录，其他直接在根目录
            candidates = [kb_dir / "openwiki" / f"{slug}.md", kb_dir / f"{slug}.md"]
            for md_path in candidates:
                if md_path.exists():
                    content = _strip_frontmatter(md_path.read_text(encoding="utf-8"))
                    return _ok({
                        "type": "source",
                        "slug": slug,
                        "content": content,
                        "source": name,
                        "source_type": "knowledge",
                    })
    raise HTTPException(404, f"Page '{slug}' not found")



# ── Topics ──────────────────────────────────────────────────────

try:
    from stores.topics import (
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
        from stores.wiki import write_page
        write_page(slug, "entity", content)

        # 更新 topic 状态
        publish_topic(slug, wiki_module)

        return _ok({"slug": slug, "wiki_module": wiki_module, "published": True})

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

except ImportError:
    pass


# ── QA Save ──────────────────────────────────────────────────────

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


# ── Global Search ───────────────────────────────────────────────

@app.get("/api/search")
async def api_search(q: str = "", limit: int = 10):
    if len(q.strip()) < 2:
        return _ok({"wiki": [], "topic": [], "qa": []})

    # 搜 wiki + 上传文档目录
    wiki_results = []

    # 搜上传文档目录
    if KNOWLEDGE_DIR.exists():
        for md_path in KNOWLEDGE_DIR.rglob("*.md"):
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
                    "title": f"📤 {title}",
                    "snippet": content[:120],
                })

    # 搜 topic
    topic_results = []
    try:
        from stores.topics import search_topics
        topic_results = search_topics(q, limit=3)
    except ImportError:
        pass

    # 搜 QA
    qa_results = []
    try:
        from stores.qa import search_questions
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
    uvicorn.run("main:app", port=8100, reload=True)
