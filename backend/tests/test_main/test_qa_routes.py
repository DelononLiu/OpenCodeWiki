"""
test_qa_routes.py — /api/qa 路由测试

使用 FastAPI TestClient + 内存 SQLite mock，无需启动 uvicorn。
"""

import pytest


class TestQAEntries:
    def test_list_entries(self, client):
        """GET /api/qa/entries 返回条目列表"""
        resp = client.get("/api/qa/entries")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "data" in data
        assert "entries" in data["data"]

    def test_list_with_params(self, client):
        """GET /api/qa/entries 支持查询参数"""
        resp = client.get("/api/qa/entries?status=pending&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_get_entry_not_found(self, client):
        """GET /api/qa/entry/{qid} 不存在返回 404"""
        resp = client.get("/api/qa/entry/99999")
        assert resp.status_code == 404

    def test_next_qid(self, client):
        """GET /api/qa/next-qid 返回 qid"""
        resp = client.get("/api/qa/next-qid")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert isinstance(data["data"]["qid"], int)

    def test_pending(self, client):
        """GET /api/qa/pending 返回待处理列表"""
        resp = client.get("/api/qa/pending")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_suggest(self, client):
        """GET /api/qa/suggest 搜索建议"""
        resp = client.get("/api/qa/suggest?q=测试")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_suggest_short_query(self, client):
        """短查询词（<2字符）返回空建议"""
        resp = client.get("/api/qa/suggest?q=a")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["suggestions"] == []


class TestQAEntryOperations:
    def test_create_and_calibrate(self, client):
        """POST 创建条目后校准"""
        # 先创建一个条目
        from stores.qa import create_entry
        entry = create_entry({"question": "路由测试", "answer": "路由答案"})

        # 校准
        resp = client.post(f"/api/qa/entry/{entry['qid']}/calibrate",
                           json={"answer": "校准答案"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["calibrated"] is True

    def test_calibrate_missing_answer(self, client):
        """校准缺少 answer 返回错误"""
        resp = client.post("/api/qa/entry/1/calibrate", json={})
        assert resp.status_code == 400

    def test_calibrate_nonexistent(self, client):
        """校准不存在的条目返回 404"""
        resp = client.post("/api/qa/entry/99999/calibrate",
                           json={"answer": "答案"})
        assert resp.status_code == 404

    def test_get_entry(self, client):
        """GET 获取单个条目"""
        from stores.qa import create_entry
        entry = create_entry({"question": "单个获取"})

        resp = client.get(f"/api/qa/entry/{entry['qid']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["question"] == "单个获取"
