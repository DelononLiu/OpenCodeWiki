import asyncio
import json
import os
import time
import yaml
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import AsyncOpenAI

from backend.config import Config, load_config
from backend.database import init_databases
from backend.stores.kb import create_kb, list_kbs, get_kb, delete_kb, update_kb_credentials, ensure_default_kb, DEFAULT_KB_NAME
from backend.stores.doc import create_document, list_documents, get_document, delete_document
from backend.stores.session import create_session, list_sessions, get_session, delete_session, create_message, get_messages
from backend.stores.task import create_task, get_task, list_tasks, cancel_task
from backend.knowledge.importer import import_document, compute_hash
from backend.knowledge.embedder import Embedder
from backend.pipeline.events import PipelineEvent, EventNames
from backend.pipeline.pipeline import Pipeline, PipelinePlan
from backend.pipeline.plugins.query_understand import QueryUnderstandPlugin
from backend.pipeline.plugins.search import SearchPlugin
from backend.pipeline.plugins.search_expand import ExpandContextPlugin
from backend.pipeline.plugins.rerank import RerankPlugin
from backend.pipeline.plugins.context_build import ContextBuildPlugin
from backend.pipeline.plugins.chat_complete import ChatCompletePlugin
from backend.task_worker.worker import TaskWorker
from backend.task_worker.plugins.rebuild import RebuildPlugin
from backend.task_worker.plugins.sync_repo import SyncRepoPlugin
from backend.sync import git_sync, svn_sync


def _load_prompt(cfg: Config, name: str) -> str:
    path = os.path.join(cfg.prompts.dir, name)
    if os.path.exists(path):
        with open(path) as f:
            data = yaml.safe_load(f)
        templates = data.get("templates", [])
        for t in templates:
            if t.get("default"):
                return t.get("content", "")
        if templates:
            return templates[0].get("content", "")
    return ""


async def _fetch_commit_and_update(kb_id: str, repo_url: str, branch: str,
                                   repo_type: str = "git",
                                   svn_username: str = "", svn_password: str = "") -> None:
    """Fetch remote commit/revision hash and update KB card immediately."""
    try:
        from backend.database import get_knora_db
        if repo_type == "svn":
            ver = await svn_sync.get_head_revision(repo_url, branch, svn_username, svn_password)
        else:
            ver = await git_sync.get_remote_head_commit(repo_url, branch)
        if ver:
            db = get_knora_db()
            db.execute("UPDATE knowledge_bases SET repo_version = ? WHERE id = ?", (ver, kb_id))
            db.commit()
    except Exception:
        pass  # non-critical; version will appear after first sync


def create_app(cfg: Config | None = None) -> FastAPI:
    if cfg is None:
        cfg = load_config()

    init_databases(cfg)

    # Ensure default KB + auto-readme
    default_kb = ensure_default_kb(cfg.embedding.model)
    about_dir = os.path.join(os.path.expanduser(cfg.database.path), "knowledge", DEFAULT_KB_NAME)
    about_path = os.path.join(about_dir, "about-opencodewiki.md")
    if not os.path.exists(about_path):
        os.makedirs(about_dir, exist_ok=True)
        with open(about_path, "w") as f:
            f.write(f"# OpenCodeWiki\n\n"
                    f"OpenCodeWiki 是一个面向团队的知识库问答系统。\n\n"
                    f"## 核心功能\n\n"
                    f"- **知识库管理**: 上传 Markdown、PDF、DOCX、TXT 文档，自动切片、向量化、全文索引\n"
                    f"- **智能问答**: 基于 Event Pipeline 的 RAG 检索增强生成\n"
                    f"- **意图路由**: 自动识别问候/检索/通用意图，按需检索\n\n"
                    f"## 技术架构\n\n"
                    f"- Pipeline: QueryUnderstand → Search → Rerank → ContextBuild → ChatComplete\n"
                    f"- 向量存储: sqlite-vec + FTS5 全文检索\n"
                    f"- LLM: OpenAI 兼容接口\n"
                    f"- Embedding: {cfg.embedding.model}\n\n"
                    f"## 快速开始\n\n"
                    f"1. 在「知识库」页面创建知识库，上传文档\n"
                    f"2. 在「新问题」页面选择知识库，开始提问\n"
                    f"3. 无需选择知识库时，默认搜索全部知识库\n")
        # Register in DB (no async import during startup)
        doc = create_document(default_kb["id"], "about-opencodewiki.md",
                              about_path, compute_hash(about_path), "md")
        # Mark as imported — upload to default KB via rebuild later
        from backend.stores.doc import update_document_status
        update_document_status(doc["id"], "completed")

    app = FastAPI(title="OpenCodeWiki", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Background Task Worker ──
    worker = TaskWorker(cfg)
    worker.on("rebuild", RebuildPlugin(cfg))
    worker.on("sync_repo", SyncRepoPlugin(cfg))

    @app.on_event("startup")
    async def _start_worker():
        asyncio.create_task(worker.run())

    # ── Config ──
    @app.get("/api/config")
    async def get_config():
        return {
            "llm": {"provider": cfg.llm.provider, "model": cfg.llm.model, "base_url": cfg.llm.base_url},
            "embedding": {"provider": cfg.embedding.provider, "model": cfg.embedding.model},
        }

    @app.put("/api/config")
    async def put_config(data: dict):
        # Simple config update - write to config.yaml
        return {"updated": True}

    # ── Wiki (knowledge bases at ~/.opencodewiki/knowledge/{kb_name}/*.md) ──
    KNOWLEDGE_ROOT = os.path.join(os.path.expanduser("~"), ".opencodewiki", "knowledge")
    PAGES_ROOT = os.path.join(os.path.expanduser("~"), ".opencodewiki", "pages")

    def _scan_dir_to_cache(root_dir: str, valid_kb_names: set | None = None) -> list[dict]:
        """Scan a directory for .md files and write .wiki_modules.json cache.
        Returns the module list."""
        modules = []
        if not os.path.isdir(root_dir):
            return modules
        for kb_name in sorted(os.listdir(root_dir)):
            kb_dir = os.path.join(root_dir, kb_name)
            if not os.path.isdir(kb_dir):
                continue
            if valid_kb_names and kb_name not in valid_kb_names:
                continue  # skip legacy dirs
            entries = []
            for f in sorted(os.listdir(kb_dir)):
                if f.endswith(".md"):
                    slug = f.replace(".md", "")
                    fp = os.path.join(kb_dir, f)
                    title = slug
                    try:
                        with open(fp, encoding="utf-8") as mdf:
                            for line in mdf:
                                line = line.strip()
                                if line.startswith("# ") and not line.startswith("##"):
                                    title = line[2:].strip()
                                    break
                    except Exception:
                        pass
                    entries.append({"slug": slug, "title": title})
                    modules.append({
                        "slug": slug, "name": f"{kb_name} / {title}",
                        "type": "source", "title": title, "kb_name": kb_name,
                    })
            cache_path = os.path.join(kb_dir, ".wiki_modules.json")
            try:
                with open(cache_path, "w") as f:
                    json.dump(entries, f)
            except Exception:
                pass
        return modules

    def _scan_knowledge_modules() -> list[dict]:
        """Scan knowledge/ dir, caching results to .wiki_modules.json per KB."""
        valid_kb_names = {kb["name"] for kb in list_kbs()}
        return _scan_dir_to_cache(KNOWLEDGE_ROOT, valid_kb_names)

    def _scan_pages_modules() -> list[dict]:
        """Scan pages/ dir, caching results."""
        modules = []
        if not os.path.isdir(PAGES_ROOT):
            return modules
        for root, dirs, files in os.walk(PAGES_ROOT):
            for f in files:
                if f.endswith(".md"):
                    rel = os.path.relpath(os.path.join(root, f), PAGES_ROOT)
                    slug = "pages/" + rel.replace(os.sep, "/").replace(".md", "")
                    modules.append({
                        "slug": slug,
                        "name": rel.replace(os.sep, " / ").replace(".md", ""),
                        "type": "source",
                        "title": f.replace(".md", ""),
                    })
        # Cache pages/ as a whole
        cache_path = os.path.join(PAGES_ROOT, ".wiki_modules.json")
        try:
            with open(cache_path, "w") as f:
                json.dump(modules, f)
        except Exception:
            pass
        return modules

    def _read_knowledge_cache() -> list[dict]:
        """Read modules from per-KB .wiki_modules.json cache files."""
        modules = []
        valid_kb_names = {kb["name"] for kb in list_kbs()}
        if not os.path.isdir(KNOWLEDGE_ROOT):
            return modules
        for kb_name in sorted(os.listdir(KNOWLEDGE_ROOT)):
            kb_dir = os.path.join(KNOWLEDGE_ROOT, kb_name)
            cache_path = os.path.join(kb_dir, ".wiki_modules.json")
            if not os.path.isdir(kb_dir) or kb_name not in valid_kb_names:
                continue
            try:
                with open(cache_path) as f:
                    data = json.load(f)
                for entry in data:
                    slug = entry["slug"] if isinstance(entry, dict) else entry
                    title = entry.get("title", slug) if isinstance(entry, dict) else slug
                    modules.append({
                        "slug": slug,
                        "name": f"{kb_name} / {title}",
                        "type": "source",
                        "title": title,
                        "kb_name": kb_name,
                    })
            except Exception:
                continue  # no cache, skip — caller falls back to scan
        return modules

    def _read_pages_cache() -> list[dict]:
        """Read modules from pages/.wiki_modules.json cache."""
        cache_path = os.path.join(PAGES_ROOT, ".wiki_modules.json")
        try:
            with open(cache_path) as f:
                return json.load(f)
        except Exception:
            return []

    @app.get("/api/wiki/modules")
    async def api_wiki_modules():
        """List wiki modules. Reads from .wiki_modules.json cache, falls back to scan."""
        # Try cache first
        modules = _read_knowledge_cache()
        if not modules:
            modules = _scan_knowledge_modules()
        # Pages: try cache, fall back to scan
        pages_modules = _read_pages_cache()
        if not pages_modules:
            pages_modules = _scan_pages_modules()
        modules.extend(pages_modules)
        return {"ok": True, "data": modules}

    @app.get("/api/wiki/{slug:path}")
    async def api_wiki_page(slug: str, kb: str = ""):
        """Get wiki page content by slug (just the filename).
        Pass ?kb=KB名称 to scope lookup to a specific knowledge base."""
        if os.path.isdir(KNOWLEDGE_ROOT):
            for kb_name in os.listdir(KNOWLEDGE_ROOT):
                if kb and kb_name != kb:
                    continue
                for sub in ("", "openwiki/"):
                    path = os.path.join(KNOWLEDGE_ROOT, kb_name, sub, slug + ".md")
                    if os.path.isfile(path):
                        with open(path, encoding="utf-8") as f:
                            content = f.read()
                        return {"ok": True, "data": {"slug": slug, "content": content, "title": slug}}
        # Second try: pages/ (legacy with path prefix)
        if slug.startswith("pages/"):
            path = os.path.join(PAGES_ROOT, slug[6:] + ".md")
        else:
            path = os.path.join(PAGES_ROOT, slug + ".md")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                content = f.read()
            return {"ok": True, "data": {"slug": slug, "content": content, "title": os.path.basename(path).replace(".md", "")}}
        raise HTTPException(404, "Wiki page not found")

    @app.post("/api/wiki/refresh-cache")
    async def api_refresh_cache():
        """Force rebuild all wiki module caches."""
        _scan_knowledge_modules()
        _scan_pages_modules()
        return {"ok": True, "refreshed": True}

    def _refresh_kb_cache(kb_name: str):
        """Rebuild .wiki_modules.json for a single KB."""
        kb_dir = os.path.join(KNOWLEDGE_ROOT, kb_name)
        if os.path.isdir(kb_dir):
            files = [f.replace(".md", "") for f in sorted(os.listdir(kb_dir)) if f.endswith(".md")]
            try:
                with open(os.path.join(kb_dir, ".wiki_modules.json"), "w") as f:
                    json.dump(files, f)
            except Exception:
                pass

    @app.get("/api/knowledge")
    async def api_knowledge():
        """List KB names from DB only (not filesystem scan)."""
        data = [{"name": kb["name"]} for kb in list_kbs()]
        return {"ok": True, "data": data}

    # ── Knowledge Bases ──
    class CreateKBRequest(BaseModel):
        name: str
        description: str = ""
        repo_url: str = ""
        repo_type: str = ""
        repo_branch: str = ""
        content_type: str = "docs"
        svn_username: str = ""
        svn_password: str = ""

    class SVNAuthRequest(BaseModel):
        username: str = ""
        password: str = ""
        save_credentials: bool = False

    class SVNCheckRequest(BaseModel):
        repo_url: str
        repo_branch: str = "trunk"
        username: str = ""
        password: str = ""

    @app.post("/api/svn/check-auth")
    async def api_svn_check_auth(req: SVNCheckRequest):
        """Pre-check if an SVN repo requires authentication before creating a task."""
        try:
            ver = await svn_sync.get_head_revision(
                req.repo_url, req.repo_branch,
                req.username or None, req.password or None,
            )
            return {"auth_required": False, "revision": ver}
        except svn_sync.SVNAuthError:
            return {"auth_required": True}
        except Exception:
            return {"auth_required": True, "error": "无法连接"}

    class RepoCheckRequest(BaseModel):
        repo_url: str
        repo_type: str = "git"
        repo_branch: str = "main"
        username: str = ""
        password: str = ""

    @app.post("/api/check-repo-auth")
    async def api_check_repo_auth(req: RepoCheckRequest):
        """Pre-check: validate branch, detect auth requirements."""
        try:
            # ── SVN ──
            if req.repo_type == "svn":
                try:
                    ver = await svn_sync.get_head_revision(
                        req.repo_url, req.repo_branch,
                        req.username or None, req.password or None,
                    )
                    return {"ok": True, "auth_required": False, "revision": ver}
                except svn_sync.SVNAuthError:
                    return {"ok": True, "auth_required": True}

            # ── Git HTTPS / HTTP ──
            if req.repo_type == "git" and req.repo_url.startswith(("http://", "https://")):
                url = git_sync._embed_credentials(req.repo_url, req.username, req.password)
                try:
                    # 1. Try without auth first to detect auth requirement
                    ver = await git_sync.get_remote_head_commit(url, req.repo_branch)
                except git_sync.GITAuthError:
                    return {"ok": True, "auth_required": True}
                except Exception:
                    # Can't access at all — might be auth, might be network
                    return {"ok": True, "auth_required": True}

                # Successfully connected — now validate branch
                if not ver:
                    default = await git_sync.get_default_branch(url)
                    if req.repo_branch != (default or "main"):
                        return {
                            "ok": False, "auth_required": False,
                            "error": f"分支 '{req.repo_branch}' 不存在" + (f"，仓库默认分支是 '{default}'" if default else ""),
                            "default_branch": default or "",
                        }
                    return {"ok": True, "auth_required": True}
                return {"ok": True, "auth_required": False, "revision": ver}

            # ── Git local / SSH ── no password needed
            if req.repo_type == "git":
                ver = await git_sync.get_remote_head_commit(req.repo_url, req.repo_branch)
                if not ver:
                    default = await git_sync.get_default_branch(req.repo_url)
                    if req.repo_branch != (default or "main"):
                        return {
                            "ok": False, "auth_required": False,
                            "error": f"分支 '{req.repo_branch}' 不存在" + (f"，仓库默认分支是 '{default}'" if default else ""),
                            "default_branch": default or "",
                        }
                return {"ok": True, "auth_required": False, "revision": ver or ""}

            return {"ok": True, "auth_required": False}
        except Exception as e:
            return {"ok": False, "error": f"检查失败: {str(e)}"}

    @app.post("/api/kb")
    async def api_create_kb(req: CreateKBRequest):
        try:
            kb = create_kb(req.name, req.description, embedding_model=cfg.embedding.model,
                            repo_url=req.repo_url, repo_type=req.repo_type,
                            repo_branch=req.repo_branch, content_type=req.content_type,
                            svn_username=req.svn_username, svn_password=req.svn_password)
            # Fetch remote commit/revision hash in background so card shows version immediately
            if req.repo_url and req.repo_type == "git":
                asyncio.create_task(_fetch_commit_and_update(kb["id"], req.repo_url, req.repo_branch or "main"))
            elif req.repo_url and req.repo_type == "svn":
                asyncio.create_task(_fetch_commit_and_update(kb["id"], req.repo_url, req.repo_branch or "trunk",
                                                              repo_type="svn", svn_username=req.svn_username,
                                                              svn_password=req.svn_password))
            return kb
        except ValueError as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/api/kb")

    @app.get("/api/kb")
    async def api_list_kbs():
        return list_kbs()

    @app.get("/api/kb/{kb_id}")
    async def api_get_kb(kb_id: str):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        return kb

    @app.put("/api/kb/{kb_id}")
    async def api_update_kb(kb_id: str, data: dict):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        # Update name/description in place — simplified
        from backend.database import get_knora_db
        db = get_knora_db()
        if "name" in data:
            db.execute("UPDATE knowledge_bases SET name = ? WHERE id = ?", (data["name"], kb_id))
        if "description" in data:
            db.execute("UPDATE knowledge_bases SET description = ? WHERE id = ?", (data["description"], kb_id))
        db.commit()
        return get_kb(kb_id)

    @app.delete("/api/kb/{kb_id}")
    async def api_delete_kb(kb_id: str):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        if kb.get("is_default"):
            raise HTTPException(400, "默认知识库不可删除")
        from backend.knowledge.vector_store import delete_by_kb_id
        delete_by_kb_id(kb_id)
        delete_kb(kb_id)
        # Remove knowledge directory on disk
        kb_dir = os.path.join(os.path.expanduser(cfg.database.path), "knowledge", kb["name"])
        if os.path.isdir(kb_dir):
            import shutil
            shutil.rmtree(kb_dir)
        return {"deleted": True}

    # ── Documents ──
    @app.post("/api/kb/{kb_id}/documents")
    async def api_upload_document(kb_id: str, file: UploadFile = File(...)):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")

        # Save file to ~/.opencodewiki/knowledge/{kb_name}/
        files_dir = os.path.join(os.path.expanduser(cfg.database.path), "knowledge", kb["name"])
        os.makedirs(files_dir, exist_ok=True)
        file_path = os.path.join(files_dir, file.filename)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        file_hash = compute_hash(file_path)
        ext = os.path.splitext(file.filename)[1].lstrip(".").lower()

        # Check duplicate
        docs = list_documents(kb_id)
        for d in docs:
            if d["file_hash"] == file_hash and d["title"] == file.filename:
                return d

        doc = create_document(kb_id, file.filename, file_path, file_hash, ext)

        # Async import + refresh wiki cache after import
        asyncio.create_task(import_document(doc["id"], file_path, kb_id, cfg))
        _refresh_kb_cache(kb["name"])

        return doc

    @app.get("/api/kb/{kb_id}/documents")
    async def api_list_documents(kb_id: str):
        return list_documents(kb_id)

    @app.get("/api/kb/{kb_id}/documents/{doc_id}")
    async def api_get_document(kb_id: str, doc_id: str):
        doc = get_document(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        return doc

    @app.delete("/api/kb/{kb_id}/documents/{doc_id}")
    async def api_delete_document(kb_id: str, doc_id: str):
        from backend.knowledge.vector_store import delete_by_doc_id
        kb = get_kb(kb_id)
        delete_by_doc_id(doc_id)
        delete_document(doc_id)
        if kb:
            _refresh_kb_cache(kb["name"])
        return {"deleted": True}

    @app.post("/api/kb/{kb_id}/documents/{doc_id}/rebuild")
    async def api_rebuild_document(kb_id: str, doc_id: str):
        doc = get_document(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")

        # Clear old data and re-import
        from backend.knowledge.vector_store import delete_by_doc_id
        delete_by_doc_id(doc_id)
        delete_document(doc_id)

        new_doc = create_document(kb_id, doc["title"], doc["file_path"], doc["file_hash"], doc["file_type"])
        asyncio.create_task(import_document(new_doc["id"], doc["file_path"], kb_id, cfg))
        return {"rebuilt": True, "doc_id": new_doc["id"]}

    # ── Sessions ──
    @app.get("/api/sessions")
    async def api_list_sessions(kb_id: str | None = None):
        return list_sessions(kb_id)

    @app.get("/api/sessions/{sid}")
    async def api_get_session(sid: str):
        ses = get_session(sid)
        if not ses:
            raise HTTPException(404, "Session not found")
        messages = get_messages(sid)
        return {**ses, "messages": messages}

    @app.delete("/api/sessions/{sid}")
    async def api_delete_session(sid: str):
        delete_session(sid)
        return {"deleted": True}

    # ── Tasks ──
    class CreateTaskRequest(BaseModel):
        type: str
        kb_id: str | None = None
        repo_id: str | None = None
        params: dict | None = None

    @app.get("/api/tasks")
    async def api_list_tasks(status: str | None = None, type: str | None = None):
        return list_tasks(status, type)

    @app.post("/api/tasks")
    async def api_create_task(req: CreateTaskRequest):
        return create_task(req.type, req.kb_id, req.repo_id, req.params)

    @app.get("/api/tasks/{task_id}")
    async def api_get_task(task_id: str):
        t = get_task(task_id)
        if not t:
            raise HTTPException(404, "Task not found")
        return t

    @app.post("/api/tasks/{task_id}/cancel")
    async def api_cancel_task(task_id: str):
        cancel_task(task_id)
        return {"cancelled": True}

    # ── Rebuild ──
    @app.post("/api/kb/{kb_id}/rebuild")
    async def api_rebuild_kb(kb_id: str):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        task = create_task("rebuild", kb_id=kb_id, params={"kb_id": kb_id})
        return task

    @app.post("/api/kb/rebuild-all")
    async def api_rebuild_all():
        task = create_task("rebuild")
        return task

    # ── Sync ──
    class SyncKBRequest(BaseModel):
        svn_username: str = ""
        svn_password: str = ""

    @app.post("/api/kb/{kb_id}/sync")
    async def api_sync_kb(kb_id: str, req: SyncKBRequest | None = None):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        if not kb.get("repo_url"):
            raise HTTPException(400, "知识库没有关联远程仓库")
        params = {"kb_id": kb_id}
        if req and req.svn_username:
            params["svn_username"] = req.svn_username
        if req and req.svn_password:
            params["svn_password"] = req.svn_password
        task = create_task("sync_repo", kb_id=kb_id, params=params)
        return task

    @app.post("/api/kb/{kb_id}/svn-auth")
    async def api_svn_auth(kb_id: str, data: SVNAuthRequest):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")
        if kb.get("repo_type") != "svn":
            raise HTTPException(400, "知识库不是 SVN 类型")

        username = data.username
        password = data.password
        save_creds = data.save_credentials

        if save_creds:
            update_kb_credentials(kb_id, username, password)

        # Cancel any pending/running sync tasks for this KB to avoid stale auth_required dialogs
        from backend.stores.task import create_task, list_tasks, update_task_status
        for old_task in list_tasks(status="running", type="sync_repo") + list_tasks(status="pending", type="sync_repo"):
            if old_task.get("kb_id") == kb_id:
                update_task_status(old_task["id"], "cancelled")

        task_params = {"kb_id": kb_id}
        if not save_creds:
            task_params["svn_username"] = username
            task_params["svn_password"] = password
        task = create_task("sync_repo", kb_id=kb_id, params=task_params)

        return {"ok": True, "task_id": task["id"]}

    # ── QA (SSE) ──
    class QARequest(BaseModel):
        kb_id: str = ""
        question: str
        session_id: str = ""

    @app.post("/api/qa")
    async def api_qa(req: QARequest):
        kb = get_kb(req.kb_id) if req.kb_id else None

        # Build pipeline — WeKnora-style: multiple plugins per event
        client = AsyncOpenAI(api_key=cfg.llm.api_key, base_url=cfg.llm.base_url)
        embedder = Embedder(
            client=AsyncOpenAI(api_key=cfg.embedding.api_key, base_url=cfg.embedding.base_url),
            model=cfg.embedding.model, dimensions=cfg.embedding.dimensions,
        )
        system_prompt = _load_prompt(cfg, "system_prompt.yaml")
        rewrite_prompt = _load_prompt(cfg, "rewrite.yaml")
        context_template = _load_prompt(cfg, "context_template.yaml")
        keywords_prompt = _load_prompt(cfg, "keywords_extraction.yaml")
        pipeline = Pipeline()
        pipeline.on(EventNames.QUERY_UNDERSTAND, QueryUnderstandPlugin(
            client=client, model=cfg.llm.model,
            keywords_prompt=keywords_prompt, rewrite_prompt=rewrite_prompt,
        ))
        pipeline.on(EventNames.SEARCH, SearchPlugin(
            embedder=embedder,
            top_k=cfg.retrieval.vector_top_k,
            keyword_top_k=cfg.retrieval.keyword_top_k,
            rrf_k=cfg.retrieval.rrf_k,
        ))
        pipeline.on(EventNames.SEARCH, ExpandContextPlugin(expand_count=1, expand_top_k=3))
        pipeline.on(EventNames.RERANK, RerankPlugin(top_k=cfg.retrieval.rerank_top_k))
        pipeline.on(EventNames.CONTEXT_BUILD, ContextBuildPlugin(
            system_prompt_template=system_prompt,
            context_template=context_template,
        ))

        chat_plugin = ChatCompletePlugin(
            client=client, model=cfg.llm.model,
            max_tokens=cfg.llm.max_tokens, temperature=cfg.llm.temperature,
        )
        pipeline.on(EventNames.CHAT_COMPLETE, chat_plugin)

        ALL_KB = '__all__'
        if req.kb_id and req.kb_id != ALL_KB:
            kb_ids = [req.kb_id]
        else:
            all_kbs = list_kbs()
            kb_ids = [kb["id"] for kb in all_kbs]

        # ── Multi-turn session management ──
        session_id = None
        history = []

        if req.kb_id:
            if req.session_id:
                # Reuse existing session
                ses = get_session(req.session_id)
                if ses:
                    session_id = req.session_id
                    # Load history from DB (past turns only, before saving current user message)
                    msgs = get_messages(session_id)
                    history = [
                        {"role": m["role"], "content": m["content"]}
                        for m in msgs[-10:]
                    ]
                else:
                    # session_id invalid, create new
                    ses = create_session(req.kb_id, req.question[:50])
                    session_id = ses["id"]
            else:
                # First turn — create session
                ses = create_session(req.kb_id, req.question[:50])
                session_id = ses["id"]

            # Save current user message to DB
            create_message(session_id, "user", req.question, "[]", 0)

        event = PipelineEvent(
            question=req.question, kb_ids=kb_ids,
            session_id=session_id, history=history,
        )
        event = await pipeline.run(event, until=EventNames.CONTEXT_BUILD)

        # ── Build stage progress info for frontend ──
        _STAGE_LABELS = {
            EventNames.QUERY_UNDERSTAND: "意图理解",
            EventNames.SEARCH: "检索",
            EventNames.RERANK: "排序",
            EventNames.CONTEXT_BUILD: "上下文构建",
        }
        completed_stages = []
        for sn in [EventNames.QUERY_UNDERSTAND, EventNames.SEARCH, EventNames.RERANK, EventNames.CONTEXT_BUILD]:
            info = {"name": _STAGE_LABELS.get(sn, sn), "status": "completed", "duration_ms": int(pipeline.timings.get(sn, 0))}
            if sn == EventNames.QUERY_UNDERSTAND:
                info["detail"] = f"{len(event.keywords)} 关键词 · {len(event.rewritten_queries)} 改写"
            elif sn == EventNames.SEARCH:
                info["detail"] = f"{len(event.search_results)} 个结果"
            elif sn == EventNames.RERANK:
                info["detail"] = f"top {len(event.reranked_results)}"
            elif sn == EventNames.CONTEXT_BUILD:
                info["detail"] = f"{len(event.context_text)} 字符"
            completed_stages.append(info)
        unique_docs = len(set(s.doc_title for s in event.search_results))
        stage_payload = json.dumps({
            "stages": completed_stages,
            "summary": {"queries": len(event.rewritten_queries), "docs": unique_docs, "chunks": len(event.search_results)},
        })

        async def event_stream():
            # Emit stages info before anything else
            yield f"event: stages\ndata: {stage_payload}\n\n"

            # Emit session_id immediately so frontend can update URL
            if session_id:
                yield f"event: session\ndata: {json.dumps({'session_id': session_id})}\n\n"

            full_answer = ""
            full_thinking = ""
            llm_start = time.monotonic()
            yield f"event: stage_start\ndata: {json.dumps({'name': 'LLM推理'})}\n\n"
            async for sse_chunk in chat_plugin.stream(event):
                yield sse_chunk
                try:
                    lines = sse_chunk.strip().split("\n")
                    event_name = ""
                    for line in lines:
                        if line.startswith("event: "):
                            event_name = line[7:].strip()
                        elif line.startswith("data: ") and event_name in ("token", "think"):
                            data = json.loads(line[6:])
                            if "text" in data:
                                if event_name == "token":
                                    full_answer += data["text"]
                                elif event_name == "think":
                                    full_thinking += data["text"]
                except Exception:
                    pass
                if "event: done" in sse_chunk or "event: error" in sse_chunk:
                    llm_dur = int((time.monotonic() - llm_start) * 1000)
                    stage_end = {"name": "LLM推理", "status": "completed" if "done" in sse_chunk else "failed", "duration_ms": llm_dur, "detail": cfg.llm.model}
                    yield f"event: stage_end\ndata: {json.dumps(stage_end)}\n\n"
                    # Save assistant message if session exists
                    if session_id:
                        sources_json = json.dumps([s.model_dump() for s in event.sources]) if event.sources else "[]"
                        token_count = len(full_answer.split())
                        create_message(session_id, "assistant", full_answer, sources_json, token_count, thinking=full_thinking)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    cfg = load_config()
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.server.host, port=cfg.server.port)
