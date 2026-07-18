"""
test_search_routes.py — /api/search 路由测试
"""

from unittest.mock import patch


class TestSearch:
    def test_search_short_query(self, client):
        """短查询词（<2字符）返回空结果"""
        resp = client.get("/api/search?q=a")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["wiki"] == []
        assert data["data"]["topic"] == []

    def test_search_with_topic_results(self, client):
        """搜索返回 topic 结果"""
        from stores.topics import create_topic
        create_topic("database-config", "数据库配置", "数据库相关配置")

        resp = client.get("/api/search?q=database")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]["topic"]) >= 1

    def test_search_with_qa_results(self, client):
        """搜索返回 QA 结果"""
        from stores.qa import create_entry
        create_entry({"question": "如何配置数据库连接", "answer": "数据库连接配置方法"})

        resp = client.get("/api/search?q=数据库")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]["qa"]) >= 1

    def test_search_mixed_results(self, client):
        """搜索混合返回"""
        from stores.topics import create_topic
        from stores.qa import create_entry

        create_topic("deploy-guide", "部署指南")
        create_entry({"question": "如何部署应用", "answer": "部署步骤"})

        resp = client.get("/api/search?q=部署")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]["topic"]) >= 1 or len(data["data"]["qa"]) >= 1
