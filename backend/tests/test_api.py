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
    # 占位 key：sediment 路由构造 AsyncOpenAI 需要非空 api_key（openai>=1.55 构造期校验）；
    # 测试均 monkeypatch 了 sediment 函数，不会产生真实 LLM 调用。
    cfg.llm.api_key = "test-dummy-key"
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

@pytest.mark.asyncio
async def test_sediment_session_to_card(client, monkeypatch):
    from backend import sediment
    async def fake_refine(client, model, question, answer):
        return {"title": "提炼卡", "content": "提炼后的内容"}
    monkeypatch.setattr(sediment, "refine_qa_to_card", fake_refine)

    headers = await _auth(client, "alice")
    r = await client.post("/api/sessions", json={"kb_id": "", "title": "会话"}, headers=headers)
    sid = r.json()["id"]
    # 塞一条问答（模拟 SSE 已保存）
    from backend.stores.session import create_message
    from backend.database import get_knora_db  # 无需——create_message 直接入库
    create_message(sid, "user", "异步队列怎么实现？", "[]", 0)
    create_message(sid, "assistant", "用 celery 实现", "[]", 10)

    r = await client.post(f"/api/sessions/{sid}/sediment", json={"kind": "card"}, headers=headers)
    assert r.status_code == 200
    item = r.json()
    assert item["form"] == "card" and item["scope"] == "personal"
    assert item["title"] == "提炼卡"

    # 派生记录
    from backend.database import get_knora_db
    row = get_knora_db().execute(
        "SELECT 1 FROM item_derivations WHERE item_id = ? AND source_ref = ?",
        (item["id"], sid)).fetchone()
    assert row is not None

@pytest.mark.asyncio
async def test_sediment_requires_ownership(client, monkeypatch):
    from backend import sediment
    async def fake_refine(client, model, question, answer):
        return {"title": "t", "content": "c"}
    monkeypatch.setattr(sediment, "refine_qa_to_card", fake_refine)

    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    r = await client.post("/api/sessions", json={"kb_id": "", "title": "s"}, headers=alice)
    sid = r.json()["id"]
    r = await client.post(f"/api/sessions/{sid}/sediment", json={"kind": "card"}, headers=bob)
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_draft_article_from_cards(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "聚合文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)

    headers = await _auth(client, "alice")
    c1 = (await client.post("/api/items", json={"title": "卡1", "content_md": "内容1", "scope": "team"}, headers=headers)).json()
    c2 = (await client.post("/api/items", json={"title": "卡2", "content_md": "内容2", "scope": "team"}, headers=headers)).json()
    r = await client.post("/api/articles/draft", json={"item_ids": [c1["id"], c2["id"]]}, headers=headers)
    assert r.status_code == 200
    art = r.json()
    assert art["form"] == "article" and art["scope"] == "personal" and art["status"] == "draft"
    # 引用链接
    from backend.database import get_knora_db
    n = get_knora_db().execute(
        "SELECT COUNT(*) FROM item_links WHERE source_id = ? AND type = 'references'",
        (art["id"],)).fetchone()[0]
    assert n == 2

# ── Task 12: 审核 API 与管理员用户管理 ──

@pytest.mark.asyncio
async def test_article_submit_and_admin_review(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "待审文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)

    alice = await _auth(client, "alice")
    # fixture 首个注册用户是 tester=admin；alice 是普通用户（作者）
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]

    # 起草文章（alice）
    r = await client.post("/api/articles/draft", json={"item_ids": []}, headers=alice)
    # 空卡片组应 400；先造卡片
    c = (await client.post("/api/items", json={"title": "卡", "content_md": "x", "scope": "team"}, headers=alice)).json()
    r = await client.post("/api/articles/draft", json={"item_ids": [c["id"]]}, headers=alice)
    art = r.json()
    assert art["status"] == "draft"

    # 提交审核
    r = await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "pending"

    # 非 admin 审批 → 403
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "approve", "reason": ""}, headers=alice)
    assert r.status_code == 403

    # 待审列表（admin）
    r = await client.get("/api/admin/reviews", headers={"Authorization": f"Bearer {admin_token}"})
    assert any(t["item_id"] == art["id"] for t in r.json())

    # admin 批准 → 发布
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "approve", "reason": "可以"}, headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    item = (await client.get(f"/api/items/{art['id']}", headers=alice)).json()
    assert item["status"] == "published" and item["scope"] == "team"

@pytest.mark.asyncio
async def test_review_reject_returns_to_draft(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "驳回文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)
    alice = await _auth(client, "alice")
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]
    c = (await client.post("/api/items", json={"title": "卡", "content_md": "x", "scope": "team"}, headers=alice)).json()
    art = (await client.post("/api/articles/draft", json={"item_ids": [c["id"]]}, headers=alice)).json()
    await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "reject", "reason": "缺引用"},
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    item = (await client.get(f"/api/items/{art['id']}", headers=alice)).json()
    assert item["status"] == "draft" and item["scope"] == "personal"

@pytest.mark.asyncio
async def test_admin_user_management(client):
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]
    await client.post("/api/auth/register", json={"username": "victim", "password": "pw"})
    users = (await client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})).json()
    victim = next(u for u in users if u["username"] == "victim")
    r = await client.post(f"/api/admin/users/{victim['id']}/deactivate",
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    # 停用后登录失败
    r = await client.post("/api/auth/login", json={"username": "victim", "password": "pw"})
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_resubmit_after_reject_returns_to_pending(client, monkeypatch):
    """驳回后重新提交应回到待审队列（Task 4 幂等逻辑的缺口修复）。"""
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "重提文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)
    alice = await _auth(client, "alice")
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]
    c = (await client.post("/api/items", json={"title": "卡", "content_md": "x", "scope": "team"}, headers=alice)).json()
    art = (await client.post("/api/articles/draft", json={"item_ids": [c["id"]]}, headers=alice)).json()
    # 提交 → 驳回
    await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    await client.post(f"/api/items/{art['id']}/review",
                      json={"action": "reject", "reason": "缺引用"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    # 再次提交 → 回到 pending，且出现在待审列表
    r = await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "pending"
    r = await client.get("/api/admin/reviews", headers={"Authorization": f"Bearer {admin_token}"})
    assert any(t["item_id"] == art["id"] for t in r.json())
