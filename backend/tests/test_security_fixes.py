"""最终全分支审查安全/集成修复的回归测试。

覆盖：
- P0-1 文章免审直发绕过（form=article & scope=team → 400）
- P0-2 个人私有内容经 Wiki 节点泄露（attach / node 渲染越权 → 403）
- P1-1 团队卡片发布/直建触发向量索引（monkeypatch index_item 断言被调用）
- P1-2 DELETE 会话无归属校验（他人会话 → 403，不存在 → 404）
- P2-2 /api/config PUT 误放行（PUT 需鉴权，GET 仍公开）
- move_node 新父不存在 → 400（原 500）
- P1-3 前端支撑：GET /api/items 支持 status 过滤
"""
import asyncio
import os
import shutil
import tempfile

import pytest
from httpx import AsyncClient, ASGITransport

from backend.config import Config
from backend.database import init_databases
from backend.main import create_app


@pytest.fixture
async def client():
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    # 占位 key：sediment/_spawn_item_index 构造 AsyncOpenAI 需要非空 api_key
    cfg.llm.api_key = "test-dummy-key"
    cfg.embedding.api_key = "test-dummy-key"
    os.makedirs(f"{db_path}/files", exist_ok=True)
    init_databases(cfg)
    app = create_app(cfg)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/auth/register", json={"username": "tester", "password": "pw"})
        ac.headers["Authorization"] = f"Bearer {r.json()['token']}"
        yield ac
    shutil.rmtree(db_path)


async def _auth(client, username="alice"):
    r = await client.post("/api/auth/register", json={"username": username, "password": "pw"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ── P0-1 文章免审直发绕过 ──

@pytest.mark.asyncio
async def test_article_cannot_be_directly_published(client):
    headers = await _auth(client)
    r = await client.post("/api/items", json={
        "title": "免审文章", "content_md": "x", "form": "article", "scope": "team",
    }, headers=headers)
    assert r.status_code == 400
    assert "审核" in r.json()["detail"]


@pytest.mark.asyncio
async def test_personal_article_draft_still_allowed(client):
    headers = await _auth(client)
    r = await client.post("/api/items", json={
        "title": "个人草稿", "content_md": "x", "form": "article", "scope": "personal",
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"


# ── P0-2 个人私有内容经 Wiki 节点泄露 ──

@pytest.mark.asyncio
async def test_cannot_attach_others_personal_item(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "alice 私有卡"}, headers=alice)).json()
    node = (await client.post("/api/wiki/nodes", json={"name": "节点"}, headers=alice)).json()
    # bob 挂 alice 的私有卡片 → 403
    r = await client.post(f"/api/wiki/nodes/{node['id']}/attach",
                          json={"item_id": frag["id"]}, headers=bob)
    assert r.status_code == 403
    # 本人可挂载
    r = await client.post(f"/api/wiki/nodes/{node['id']}/attach",
                          json={"item_id": frag["id"]}, headers=alice)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_cannot_read_others_personal_item_via_node(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "私密内容"}, headers=alice)).json()
    node = (await client.post("/api/wiki/nodes", json={"name": "挂载点"}, headers=alice)).json()
    await client.post(f"/api/wiki/nodes/{node['id']}/attach",
                      json={"item_id": frag["id"]}, headers=alice)
    # bob 读该节点 → 403
    r = await client.get(f"/api/wiki/node/{node['id']}", headers=bob)
    assert r.status_code == 403
    # alice 自己可读
    r = await client.get(f"/api/wiki/node/{node['id']}", headers=alice)
    assert r.status_code == 200 and "私密内容" in r.json()["content"]


@pytest.mark.asyncio
async def test_team_item_via_node_visible_to_all(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    card = (await client.post("/api/items", json={
        "title": "团队卡", "content_md": "公开", "scope": "team"}, headers=alice)).json()
    node = (await client.post("/api/wiki/nodes", json={"name": "挂载点"}, headers=alice)).json()
    await client.post(f"/api/wiki/nodes/{node['id']}/attach",
                      json={"item_id": card["id"]}, headers=alice)
    r = await client.get(f"/api/wiki/node/{node['id']}", headers=bob)
    assert r.status_code == 200


# ── P1-1 团队卡片发布/直建触发向量索引（路由级）──

def _patch_index(monkeypatch):
    """把 backend.main 的 index_item 换成记录调用的 async stub。"""
    import backend.main as main_module
    called = []

    async def fake_index(item, embedder):
        called.append(item["id"])

    monkeypatch.setattr(main_module, "index_item", fake_index)
    return called


@pytest.mark.asyncio
async def test_publish_card_triggers_index(client, monkeypatch):
    called = _patch_index(monkeypatch)
    headers = await _auth(client)
    frag = (await client.post("/api/fragments", json={"content": "卡片关键词"}, headers=headers)).json()
    r = await client.post(f"/api/items/{frag['id']}/publish", headers=headers)
    assert r.status_code == 200
    for _ in range(20):
        await asyncio.sleep(0)
    assert frag["id"] in called


@pytest.mark.asyncio
async def test_create_team_card_triggers_index(client, monkeypatch):
    called = _patch_index(monkeypatch)
    headers = await _auth(client)
    r = await client.post("/api/items", json={
        "title": "团队卡", "content_md": "内容", "scope": "team"}, headers=headers)
    assert r.status_code == 200
    for _ in range(20):
        await asyncio.sleep(0)
    assert r.json()["id"] in called


# ── P1-2 DELETE 会话归属校验 ──

@pytest.mark.asyncio
async def test_delete_session_ownership(client):
    alice = await _auth(client, "alice")
    bob = await _auth(client, "bob")
    r = await client.post("/api/sessions", json={"kb_id": "", "title": "alice 会话"}, headers=alice)
    sid = r.json()["id"]
    # bob 删除 alice 的会话 → 403
    r = await client.delete(f"/api/sessions/{sid}", headers=bob)
    assert r.status_code == 403
    # 不存在 → 404
    r = await client.delete("/api/sessions/no-such-session", headers=alice)
    assert r.status_code == 404
    # 本人删除 → 200
    r = await client.delete(f"/api/sessions/{sid}", headers=alice)
    assert r.status_code == 200


# ── P2-2 /api/config 仅 GET 公开 ──

@pytest.mark.asyncio
async def test_config_get_public_put_requires_auth(client):
    r = await client.get("/api/config", headers={"Authorization": ""})
    assert r.status_code == 200
    r = await client.put("/api/config", json={"llm": {"model": "x"}}, headers={"Authorization": ""})
    assert r.status_code == 401
    r = await client.put("/api/config", json={"llm": {"model": "x"}})
    assert r.status_code == 200


# ── move_node 新父不存在 → 400（原 500）──

@pytest.mark.asyncio
async def test_move_node_to_missing_parent_400(client):
    headers = await _auth(client)
    node = (await client.post("/api/wiki/nodes", json={"name": "A"}, headers=headers)).json()
    r = await client.post(f"/api/wiki/nodes/{node['id']}/move",
                          json={"parent_id": "wn-no-such"}, headers=headers)
    assert r.status_code == 400


# ── P1-3 前端支撑：GET /api/items 支持 status 过滤 ──

@pytest.mark.asyncio
async def test_list_items_filters_by_status(client):
    headers = await _auth(client)
    art = (await client.post("/api/items", json={
        "title": "草稿文章", "content_md": "x", "form": "article", "scope": "personal",
    }, headers=headers)).json()
    r = await client.get("/api/items?form=article&scope=personal&status=draft", headers=headers)
    assert any(i["id"] == art["id"] for i in r.json())
    # 提交审核后不再命中 draft，命中 pending
    await client.post(f"/api/items/{art['id']}/submit", headers=headers)
    r = await client.get("/api/items?form=article&scope=personal&status=draft", headers=headers)
    assert all(i["id"] != art["id"] for i in r.json())
    r = await client.get("/api/items?form=article&scope=personal&status=pending", headers=headers)
    assert any(i["id"] == art["id"] for i in r.json())
