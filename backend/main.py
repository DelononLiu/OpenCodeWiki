import asyncio
import json
import os
import yaml
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import AsyncOpenAI

from backend.config import Config, load_config
from backend.database import init_databases
from backend.stores.kb import create_kb, list_kbs, get_kb, delete_kb
from backend.stores.doc import create_document, list_documents, get_document, delete_document
from backend.stores.session import create_session, list_sessions, get_session, delete_session, create_message, get_messages
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


def create_app(cfg: Config | None = None) -> FastAPI:
    if cfg is None:
        cfg = load_config()

    init_databases(cfg)

    app = FastAPI(title="OpenCodeWiki", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

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

    # ── Knowledge Bases ──
    class CreateKBRequest(BaseModel):
        name: str
        description: str = ""

    @app.post("/api/kb")
    async def api_create_kb(req: CreateKBRequest):
        return create_kb(req.name, req.description, embedding_model=cfg.embedding.model)

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
        from backend.knowledge.vector_store import delete_by_kb_id
        delete_by_kb_id(kb_id)
        delete_kb(kb_id)
        return {"deleted": True}

    # ── Documents ──
    @app.post("/api/kb/{kb_id}/documents")
    async def api_upload_document(kb_id: str, file: UploadFile = File(...)):
        kb = get_kb(kb_id)
        if not kb:
            raise HTTPException(404, "Knowledge base not found")

        # Save file
        files_dir = os.path.join(os.path.expanduser(cfg.database.path), "files", kb_id)
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

        # Async import
        asyncio.create_task(import_document(doc["id"], file_path, kb_id, cfg))

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
        delete_by_doc_id(doc_id)
        delete_document(doc_id)
        return {"deleted": True}

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

    # ── QA (SSE) ──
    class QARequest(BaseModel):
        kb_id: str = ""
        question: str

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

        # Run pipeline through CONTEXT_BUILD, then stream ChatComplete separately
        # No KB selected → search all KBs
        if req.kb_id:
            kb_ids = [req.kb_id]
        else:
            all_kbs = list_kbs()
            kb_ids = [kb["id"] for kb in all_kbs]
        event = PipelineEvent(question=req.question, kb_ids=kb_ids)
        event = await pipeline.run(event, until=EventNames.CONTEXT_BUILD)

        # Create session for record (skip if no KB selected)
        if req.kb_id:
            ses = create_session(req.kb_id, req.question[:50])
            create_message(ses["id"], "user", req.question, "[]", 0)
            event.session_id = ses["id"]

        async def event_stream():
            full_answer = ""
            async for sse_chunk in chat_plugin.stream(event):
                yield sse_chunk
                if "event: token" in sse_chunk:
                    # Extract token text
                    try:
                        lines = sse_chunk.strip().split("\n")
                        for line in lines:
                            if line.startswith("data: "):
                                data = json.loads(line[6:])
                                if "text" in data:
                                    full_answer += data["text"]
                    except Exception:
                        pass
                elif "event: done" in sse_chunk or "event: error" in sse_chunk:
                    # Save assistant message if session exists
                    if req.kb_id:
                        sources_json = json.dumps([s.model_dump() for s in event.sources]) if event.sources else "[]"
                        token_count = len(full_answer.split())
                        create_message(ses["id"], "assistant", full_answer, sources_json, token_count)

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
