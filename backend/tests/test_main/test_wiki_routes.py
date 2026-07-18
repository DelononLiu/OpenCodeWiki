"""
test_wiki_routes.py — /api/wiki 路由测试

使用 FastAPI TestClient + mock store/filesystem。
注意：WIKI_BASE 模块级变量在 TestClient 多线程下 patch 不可靠，
      wiki/modules 路由可能被 catch-all 拦截，因此只测核心 wiki 功能。
"""


class TestWikiPage:
    def test_wiki_not_found(self, client):
        """GET /api/wiki/{slug} 不存在的页面返回 404"""
        resp = client.get("/api/wiki/nonexistent-page")
        assert resp.status_code == 404

    def test_wiki_via_topic(self, client):
        """通过 topic 路由获取 wiki 内容"""
        from stores.topics import create_topic
        create_topic("wiki-topic", "Wiki 主题", "主题描述")

        resp = client.get("/api/wiki/wiki-topic")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["data"]["type"] == "topic"
        assert data["data"]["slug"] == "wiki-topic"

    def test_wiki_via_stored_page(self, client):
        """通过 stores.wiki 获取已存储页面"""
        from stores.wiki import write_page
        write_page("stored-page", "entity", "# 存储页面内容")

        resp = client.get("/api/wiki/stored-page")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["type"] == "wiki"
        assert "存储页面" in data["data"]["content"]
