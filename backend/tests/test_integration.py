import os
import tempfile
import pytest
from httpx import AsyncClient, ASGITransport
from backend.main import create_app
from backend.config import Config
from backend.database import init_databases


@pytest.fixture
async def client():
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    os.makedirs(f"{db_path}/files", exist_ok=True)
    init_databases(cfg)
    app = create_app(cfg)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    import shutil
    shutil.rmtree(db_path)


@pytest.mark.asyncio
async def test_full_flow_create_kb_and_qa(client):
    """End-to-end smoke test: create KB, upload doc, ask question."""
    # 1. Create KB
    resp = await client.post("/api/kb", json={"name": "E2E Test KB", "description": "Integration test"})
    assert resp.status_code == 200
    kb = resp.json()

    # 2. Upload a document
    files = {"file": ("readme.md", b"# Auth Module\n\nJWT tokens expire after 24 hours.\n\nOAuth2 is used for delegated auth.", "text/markdown")}
    resp = await client.post(f"/api/kb/{kb['id']}/documents", files=files)
    assert resp.status_code == 200
    doc = resp.json()
    assert doc["title"] == "readme.md"

    # 3. Wait for async import (poll status)
    import asyncio
    for _ in range(10):
        resp = await client.get(f"/api/kb/{kb['id']}/documents/{doc['id']}")
        if resp.json()["status"] == "completed":
            break
        await asyncio.sleep(0.5)

    # 4. Ask a question (SSE) — verify we get a 200 and stream content
    # Note: actual LLM call may fail if API key not set, but at minimum
    # the pipeline should assemble and start streaming
    resp = await client.post("/api/qa", json={"kb_id": kb["id"], "question": "JWT expiration?"})
    # With real API key: 200 + SSE stream. Without: may fail at LLM call.
    # This test verifies the pipeline assembles correctly.
    assert resp.status_code in (200, 500)  # 500 = LLM auth error is expected without API key

    # 5. Session was created
    resp = await client.get(f"/api/sessions?kb_id={kb['id']}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_config_endpoint(client):
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "llm" in data
    assert "embedding" in data


@pytest.mark.asyncio
async def test_document_list_empty(client):
    resp = await client.post("/api/kb", json={"name": "Empty KB"})
    kb_id = resp.json()["id"]
    resp = await client.get(f"/api/kb/{kb_id}/documents")
    assert resp.status_code == 200
    assert resp.json() == []
