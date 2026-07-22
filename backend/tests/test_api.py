import pytest
from httpx import AsyncClient, ASGITransport
from backend.main import create_app
from backend.config import Config
from backend.database import init_databases
import tempfile
import os

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
async def test_create_and_list_kb(client):
    resp = await client.post("/api/kb", json={"name": "Test KB", "description": "desc"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Test KB"

    resp = await client.get("/api/kb")
    assert resp.status_code == 200
    kbs = resp.json()
    assert len(kbs) == 1

@pytest.mark.asyncio
async def test_delete_kb(client):
    resp = await client.post("/api/kb", json={"name": "To Delete"})
    kb_id = resp.json()["id"]
    resp = await client.delete(f"/api/kb/{kb_id}")
    assert resp.status_code == 200

@pytest.mark.asyncio
async def test_get_config(client):
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "llm" in data

@pytest.mark.asyncio
async def test_upload_document(client):
    # Create KB first
    resp = await client.post("/api/kb", json={"name": "Doc KB"})
    kb_id = resp.json()["id"]

    # Upload a text file
    files = {"file": ("test.txt", b"Hello world content for testing.", "text/plain")}
    resp = await client.post(f"/api/kb/{kb_id}/documents", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "test.txt"

    # List documents
    resp = await client.get(f"/api/kb/{kb_id}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
