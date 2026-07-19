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


class TestSessions:
    def test_list_sessions(self, client):
        """GET /api/sessions 返回 session 列表"""
        from stores.qa import create_entry
        create_entry({"question": "会话测试", "answer": "A", "session_id": "sess-route-test"})

        resp = client.get("/api/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        sessions = data["data"]["sessions"]
        assert any(s["session_id"] == "sess-route-test" for s in sessions)
        s = next(s for s in sessions if s["session_id"] == "sess-route-test")
        assert "root_question" in s
        assert "message_count" in s


class TestQASave:
    def test_save_creates_entry(self, client):
        """POST /api/qa/save 创建条目"""
        resp = client.post("/api/qa/save", json={
            "question": "保存测试", "answer": "答案内容",
            "session_id": "save-route-test", "session_create": False,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["data"]["qid"] > 0
        assert data["data"]["session_id"] == "save-route-test"

    def test_save_missing_question(self, client):
        """POST /api/qa/save 缺少 question 返回错误"""
        resp = client.post("/api/qa/save", json={"answer": "X"})
        assert resp.status_code == 400


class TestFeedback:
    def test_save_feedback(self, client):
        """POST /api/qa/entry/{qid}/feedback 保存反馈"""
        from stores.qa import create_entry
        entry = create_entry({"question": "反馈测试", "answer": "A", "session_id": "fb-route"})

        resp = client.post(f"/api/qa/entry/{entry['qid']}/feedback",
                           json={"feedback": "accepted"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["data"]["feedback"] == "accepted"

    def test_feedback_invalid(self, client):
        """反馈值无效返回错误"""
        resp = client.post("/api/qa/entry/1/feedback", json={"feedback": "bad"})
        assert resp.status_code == 400

    def test_feedback_not_found(self, client):
        """反馈不存在的条目返回 404"""
        resp = client.post("/api/qa/entry/99999/feedback",
                           json={"feedback": "accepted"})
        assert resp.status_code == 404


class TestSources:
    def test_get_sources(self, client):
        """GET /api/qa/entry/{qid}/sources 返回参考引用"""
        from stores.qa import create_entry
        entry = create_entry({
            "question": "引用测试", "answer": "A",
            "session_id": "src-route",
            "sources": [{"file": "a.py", "line": "L1", "snippet": "code"}],
        })

        resp = client.get(f"/api/qa/entry/{entry['qid']}/sources")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert len(data["data"]["sources"]) == 1
        assert data["data"]["sources"][0]["file"] == "a.py"

    def test_get_sources_empty(self, client):
        """无引用时返回空列表"""
        from stores.qa import create_entry
        entry = create_entry({"question": "空引用", "session_id": "src-empty"})

        resp = client.get(f"/api/qa/entry/{entry['qid']}/sources")
        assert resp.status_code == 200
        assert resp.json()["data"]["sources"] == []


class TestRelated:
    def test_get_related_empty(self, client):
        """GET /api/qa/entry/{qid}/related 无匹配 topic 返回空"""
        from stores.qa import create_entry
        entry = create_entry({"question": "Q1", "answer": "A", "session_id": "rel-no-topic"})

        resp = client.get(f"/api/qa/entry/{entry['qid']}/related")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["data"]["related"] == []
