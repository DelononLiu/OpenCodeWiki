"""
test_topic_routes.py — /api/topics 路由测试

使用 FastAPI TestClient + 内存 SQLite mock。
"""


class TestTopicList:
    def test_list_topics(self, client):
        """GET /api/topics 返回列表"""
        resp = client.get("/api/topics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert isinstance(data["data"], list)

    def test_list_with_status(self, client):
        """GET /api/topics?status=pool 按状态筛选"""
        resp = client.get("/api/topics?status=pool")
        assert resp.status_code == 200

    def test_create_topic(self, client):
        """POST /api/topics 创建 topic"""
        resp = client.post("/api/topics", json={
            "slug": "route-test",
            "name": "路由创建",
            "description": "从路由创建",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["slug"] == "route-test"

    def test_create_missing_fields(self, client):
        """POST 缺少 slug 返回错误"""
        resp = client.post("/api/topics", json={"name": "无slug"})
        assert resp.status_code == 400

    def test_get_topic(self, client):
        """GET /api/topics/{slug} 获取 topic"""
        # 先创建
        client.post("/api/topics", json={
            "slug": "get-route",
            "name": "GET路由测试",
        })
        resp = client.get("/api/topics/get-route")
        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == "GET路由测试"

    def test_get_nonexistent(self, client):
        """GET 不存在的 topic 返回 404"""
        resp = client.get("/api/topics/not-here")
        assert resp.status_code == 404


class TestTopicDraft:
    def test_save_and_get_draft(self, client):
        """POST + GET draft"""
        client.post("/api/topics", json={"slug": "draft-route", "name": "草稿路由"})

        # 保存草稿
        resp = client.post("/api/topics/draft-route/draft",
                           json={"content": "草稿内容"})
        assert resp.status_code == 200

        # 获取草稿
        resp = client.get("/api/topics/draft-route/draft")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["raw_content"] == "草稿内容"

    def test_save_draft_missing_content(self, client):
        """POST draft 缺少内容返回错误"""
        resp = client.post("/api/topics/nonexistent/draft", json={})
        assert resp.status_code == 400

    def test_edit_draft(self, client):
        """PUT draft 编辑"""
        client.post("/api/topics", json={"slug": "edit-route", "name": "编辑路由"})
        client.post("/api/topics/edit-route/draft", json={"content": "原始"})

        resp = client.put("/api/topics/edit-route/draft",
                          json={"content": "编辑后"})
        assert resp.status_code == 200
        assert resp.json()["data"]["updated"] is True


class TestPublish:
    def test_publish(self, client):
        """POST /api/topics/{slug}/publish 发布"""
        client.post("/api/topics", json={"slug": "pub-route", "name": "发布路由"})
        client.post("/api/topics/pub-route/draft", json={"content": "内容"})

        resp = client.post("/api/topics/pub-route/publish",
                           json={"wiki_module": "core-module"})
        assert resp.status_code == 200

    def test_publish_missing_module(self, client):
        """发布缺少 wiki_module 返回错误"""
        resp = client.post("/api/topics/some-slug/publish", json={})
        assert resp.status_code == 400
