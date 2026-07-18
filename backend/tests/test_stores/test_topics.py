"""
test_topics.py — Topic 存储层单元测试

从原有的 test_stores.py（unittest 风格）迁移为 pytest + fixture 风格。
测试 stores.topics 模块全部 10 个函数。
"""

import pytest
from unittest.mock import patch


class TestCreateTopic:
    def test_create_basic(self, patch_stores):
        """创建基本 topic"""
        from stores.topics import create_topic

        result = create_topic("test-topic", "测试主题", "描述")
        assert result["slug"] == "test-topic"
        assert result["status"] == "pool"

    def test_create_duplicate(self, patch_stores):
        """重复创建返回原始数据"""
        from stores.topics import create_topic

        create_topic("dup-slug", "第一次")
        result = create_topic("dup-slug", "第二次")
        assert result["slug"] == "dup-slug"


class TestListTopics:
    def test_list_all(self, patch_stores):
        """列出全部 topic"""
        from stores.topics import create_topic, list_topics

        create_topic("topic-a", "主题A")
        create_topic("topic-b", "主题B")

        topics = list_topics()
        assert len(topics) == 2
        slugs = [t["slug"] for t in topics]
        assert "topic-a" in slugs
        assert "topic-b" in slugs

    def test_list_by_status(self, patch_stores):
        """按状态筛选"""
        from stores.topics import create_topic, publish, list_topics

        create_topic("pool-topic", "池中")
        create_topic("pub-topic", "已发布")
        publish("pub-topic", "core")

        pool_topics = list_topics("pool")
        assert all(t["status"] == "pool" for t in pool_topics)

        pub_topics = list_topics("published")
        assert all(t["status"] == "published" for t in pub_topics)


class TestGetTopic:
    def test_get_existing(self, patch_stores):
        """获取存在的 topic"""
        from stores.topics import create_topic, get_topic

        create_topic("get-test", "获取测试")
        topic = get_topic("get-test")
        assert topic is not None
        assert topic["name"] == "获取测试"
        assert "qa_entries" in topic

    def test_get_nonexistent(self, patch_stores):
        """获取不存在的 topic 返回 None"""
        from stores.topics import get_topic

        topic = get_topic("not-exists")
        assert topic is None

    def test_get_with_qa_count(self, patch_stores):
        """获取 topic 含 QA 计数"""
        from stores.topics import create_topic, link_qa, get_topic
        from stores.qa import create_entry

        create_topic("count-test", "计数测试")
        e1 = create_entry({"question": "Q1"})
        e2 = create_entry({"question": "Q2"})
        link_qa("count-test", e1["qid"])
        link_qa("count-test", e2["qid"])

        topic = get_topic("count-test")
        assert topic is not None
        # qa_entries should be in the topic dict since get_topic loads them
        assert "qa_entries" in topic


class TestLinkQA:
    def test_link_and_count(self, patch_stores):
        """关联 QA 后计数正确"""
        from stores.topics import create_topic, link_qa
        from stores.qa import create_entry

        create_topic("qa-link", "QA关联")
        e = create_entry({"question": "关联测试"})
        link_qa("qa-link", e["qid"])

        from stores.topics import list_topics
        topics = list_topics()
        topic = next(t for t in topics if t["slug"] == "qa-link")
        assert topic["qa_count"] >= 1


class TestDraft:
    def test_save_and_get(self, patch_stores):
        """保存并获取草稿"""
        from stores.topics import create_topic, save_draft, get_draft

        create_topic("draft-test", "草稿测试")
        save_draft("draft-test", "原始内容")

        draft = get_draft("draft-test")
        assert draft is not None
        assert draft["raw_content"] == "原始内容"
        assert draft["status"] == "pending"

    def test_update_content(self, patch_stores):
        """编辑草稿内容"""
        from stores.topics import create_topic, save_draft, get_draft, update_draft_content

        create_topic("edit-test", "编辑测试")
        save_draft("edit-test", "原始内容")
        update_draft_content("edit-test", "编辑后内容")

        draft = get_draft("edit-test")
        assert draft["edited_content"] == "编辑后内容"

    def test_approve(self, patch_stores):
        """审批草稿"""
        from stores.topics import create_topic, save_draft, approve_draft, get_draft

        create_topic("approve-test", "审批测试")
        save_draft("approve-test", "待审批")
        approve_draft("approve-test", "reviewer-1")

        draft = get_draft("approve-test")
        assert draft["status"] == "approved"
        assert draft["reviewer"] == "reviewer-1"

    def test_get_nonexistent_draft(self, patch_stores):
        """获取不存在的草稿返回 None"""
        from stores.topics import get_draft

        draft = get_draft("no-draft")
        assert draft is None


class TestPublish:
    def test_publish_topic(self, patch_stores):
        """沉淀 topic 为 wiki"""
        from stores.topics import create_topic, publish, get_topic

        create_topic("publish-test", "沉淀测试")
        publish("publish-test", "core-module")

        topic = get_topic("publish-test")
        assert topic["status"] == "published"
        assert topic["wiki_module"] == "core-module"


class TestSearchTopics:
    def test_search_by_slug(self, patch_stores):
        """按 slug 搜索 topic"""
        from stores.topics import create_topic, search_topics

        create_topic("database-config", "数据库配置")
        results = search_topics("database", limit=5)
        assert any("database" in r["slug"] for r in results)

    def test_search_by_name(self, patch_stores):
        """按名称搜索 topic"""
        from stores.topics import create_topic, search_topics

        create_topic("db-setup", "数据库设置")
        results = search_topics("数据库", limit=5)
        assert any("数据库" in r["name"] for r in results)

    def test_search_no_results(self, patch_stores):
        """无结果返回空列表"""
        from stores.topics import search_topics

        results = search_topics("zzz_nonexistent")
        assert results == []

    def test_search_limit(self, patch_stores):
        """搜索结果受 limit 限制"""
        from stores.topics import create_topic, search_topics

        for i in range(5):
            create_topic(f"limit-test-{i}", f"限制测试 {i}")
        results = search_topics("limit-test", limit=3)
        assert len(results) <= 3
