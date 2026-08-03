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
        r = await ac.post("/api/auth/register", json={"username": "tester", "password": "pw"})
        token = r.json()["token"]
        ac.headers["Authorization"] = f"Bearer {token}"
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
    # App startup seeds the default KB (ensure_default_kb), so assert the new
    # KB is present rather than coupling to the exact total count.
    assert any(kb["name"] == "Test KB" for kb in kbs)

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

@pytest.mark.asyncio
async def test_auth_register_login_me(client):
    resp = await client.post("/api/auth/register", json={"username": "alice", "password": "pw123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["username"] == "alice"
    assert data["user"]["role"] == "user"  # 第二个用户（fixture 已注册 tester）
    token = data["token"]

    # fixture 注册的 tester 是首个用户 → admin
    resp = await client.get("/api/auth/me")
    assert resp.json()["role"] == "admin"

    # 未登录访问受保护接口 → 401（显式清空 fixture 默认头）
    resp = await client.get("/api/kb", headers={"Authorization": ""})
    assert resp.status_code == 401

    # 带 token → 200
    resp = await client.get("/api/kb", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    # me
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"

    # 登录
    resp = await client.post("/api/auth/login", json={"username": "alice", "password": "pw123"})
    assert resp.status_code == 200

    # 错误密码 → 401
    resp = await client.post("/api/auth/login", json={"username": "alice", "password": "bad"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_second_user_is_normal(client):
    await client.post("/api/auth/register", json={"username": "alice", "password": "pw"})
    resp = await client.post("/api/auth/register", json={"username": "bob", "password": "pw"})
    assert resp.json()["user"]["role"] == "user"

@pytest.mark.asyncio
async def test_duplicate_username_register(client):
    await client.post("/api/auth/register", json={"username": "carol", "password": "pw"})
    resp = await client.post("/api/auth/register", json={"username": "carol", "password": "pw"})
    assert resp.status_code == 400

async def _auth(client, username="alice"):
    r = await client.post("/api/auth/register", json={"username": username, "password": "pw"})
    return {"Authorization": f"Bearer {r.json()['token']}"}

@pytest.mark.asyncio
async def test_fragment_capture_and_list(client):
    headers = await _auth(client)
    r = await client.post("/api/fragments", json={"content": "React 18 的并发特性", "title": "碎片一"},
                          headers=headers)
    assert r.status_code == 200
    item = r.json()
    assert item["form"] == "card" and item["scope"] == "personal" and item["status"] == "draft"

    r = await client.get("/api/fragments", headers=headers)
    items = r.json()
    assert len(items) == 1 and items[0]["title"] == "碎片一"

@pytest.mark.asyncio
async def test_create_team_card_direct(client):
    headers = await _auth(client)
    r = await client.post("/api/items", json={"title": "团队卡", "content_md": "内容", "scope": "team"},
                          headers=headers)
    assert r.status_code == 200
    assert r.json()["scope"] == "team" and r.json()["status"] == "published"

@pytest.mark.asyncio
async def test_publish_fragment_to_team(client):
    headers = await _auth(client)
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=headers)).json()
    r = await client.post(f"/api/items/{frag['id']}/publish", headers=headers)
    assert r.status_code == 200
    assert r.json()["scope"] == "team" and r.json()["status"] == "published"

@pytest.mark.asyncio
async def test_items_visibility_between_users(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    await client.post("/api/fragments", json={"content": "alice 私有"}, headers=alice)
    await client.post("/api/items", json={"title": "公共卡", "content_md": "c", "scope": "team"}, headers=alice)

    r = await client.get("/api/items", headers=bob)
    titles = [i["title"] for i in r.json()]
    assert "公共卡" in titles and "alice 私有" not in titles

@pytest.mark.asyncio
async def test_item_detail_with_links(client):
    headers = await _auth(client)
    a = (await client.post("/api/items", json={"title": "卡A", "content_md": "a", "scope": "team"}, headers=headers)).json()
    b = (await client.post("/api/items", json={"title": "卡B", "content_md": "b", "scope": "team"}, headers=headers)).json()
    r = await client.get(f"/api/items/{a['id']}", headers=headers)
    assert r.status_code == 200 and r.json()["id"] == a["id"]

@pytest.mark.asyncio
async def test_edit_personal_item_only(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=alice)).json()
    # bob 不能改 alice 的私有
    r = await client.put(f"/api/items/{frag['id']}", json={"title": "hack"}, headers=bob)
    assert r.status_code == 403
    # alice 自己可以
    r = await client.put(f"/api/items/{frag['id']}", json={"title": "改好了"}, headers=alice)
    assert r.status_code == 200 and r.json()["title"] == "改好了"

@pytest.mark.asyncio
async def test_team_published_is_read_only(client):
    headers = await _auth(client)
    card = (await client.post("/api/items", json={"title": "团队卡", "content_md": "c", "scope": "team"}, headers=headers)).json()
    r = await client.put(f"/api/items/{card['id']}", json={"title": "篡改"}, headers=headers)
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_delete_item_owner_or_admin(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=alice)).json()
    r = await client.delete(f"/api/items/{frag['id']}", headers=bob)
    assert r.status_code == 403
    r = await client.delete(f"/api/items/{frag['id']}", headers=alice)
    assert r.status_code == 200

@pytest.mark.asyncio
async def test_sessions_are_user_scoped(client):
    # 已注册 tester(admin) 并带 token；再造第二个用户
    r = await client.post("/api/auth/register", json={"username": "other", "password": "pw"})
    other_token = r.json()["token"]

    r = await client.post("/api/sessions", json={"kb_id": "", "title": "我的会话"})
    my_sid = r.json()["id"]

    # other 用户看不到我的会话
    resp = await client.get("/api/sessions", headers={"Authorization": f"Bearer {other_token}"})
    assert all(s["id"] != my_sid for s in resp.json())

    # other 用户访问我的会话详情 → 403
    resp = await client.get(f"/api/sessions/{my_sid}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 403

    # admin 可见全部
    resp = await client.get("/api/sessions")
    assert any(s["id"] == my_sid for s in resp.json())
