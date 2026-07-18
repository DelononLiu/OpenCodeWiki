"""
test_store_topics.py — Topic 存储层单元测试
"""

import os
import sys
import unittest
from pathlib import Path

# Setup: ensure we can import from the project
HERE = Path(__file__).parent.parent
sys.path.insert(0, str(HERE))

# Use a separate test database
os.environ["HOME"] = str(Path.home())

from database import get_knowledge_db, close_knowledge_db


class TestStoreTopics(unittest.TestCase):
    """Topic CRUD 操作测试"""

    @classmethod
    def setUpClass(cls):
        # Init database tables
        from database import init_databases, get_qa_db
        cls._old_home = os.environ.get("HOME")
        init_databases()
        # Ensure qa.db tables are created (needed for get_topic JOIN)
        get_qa_db()

    def setUp(self):
        # Clean topics before each test
        db = get_knowledge_db()
        db.execute("DELETE FROM topic_drafts")
        db.execute("DELETE FROM topic_qa")
        db.execute("DELETE FROM topics")
        db.commit()
        # Import here to get fresh state
        from stores.topics import create_topic
        self.create_topic = create_topic

    def test_create_topic(self):
        """创建 topic 并验证字段"""
        result = self.create_topic("test-topic", "测试主题", "这是一个测试")
        self.assertEqual(result["slug"], "test-topic")
        self.assertEqual(result["status"], "pool")

    def test_list_topics(self):
        """列出 topic"""
        self.create_topic("topic-a", "主题A")
        self.create_topic("topic-b", "主题B")

        from stores.topics import list_topics
        topics = list_topics()
        self.assertEqual(len(topics), 2)
        slugs = [t["slug"] for t in topics]
        self.assertIn("topic-a", slugs)
        self.assertIn("topic-b", slugs)

    def test_get_topic(self):
        """获取单个 topic"""
        self.create_topic("get-test", "获取测试")

        from stores.topics import get_topic
        topic = get_topic("get-test")
        self.assertIsNotNone(topic)
        self.assertEqual(topic["name"], "获取测试")

        missing = get_topic("not-exists")
        self.assertIsNone(missing)

    def test_link_qa(self):
        """关联 QA 到 topic"""
        self.create_topic("qa-link", "QA关联")

        from stores.topics import link_qa, list_topics
        link_qa("qa-link", 1)
        link_qa("qa-link", 2)

        topics = list_topics()
        topic = next(t for t in topics if t["slug"] == "qa-link")
        self.assertEqual(topic["qa_count"], 2)

    def test_draft_crud(self):
        """草稿 CRUD"""
        self.create_topic("draft-test", "草稿测试")

        from stores.topics import save_draft, get_draft, update_draft_content
        save_draft("draft-test", "原始内容")

        draft = get_draft("draft-test")
        self.assertIsNotNone(draft)
        self.assertEqual(draft["raw_content"], "原始内容")
        self.assertEqual(draft["status"], "pending")

        update_draft_content("draft-test", "编辑后内容")
        draft2 = get_draft("draft-test")
        self.assertEqual(draft2["edited_content"], "编辑后内容")

    def test_publish(self):
        """沉淀 topic 为 wiki"""
        self.create_topic("publish-test", "沉淀测试")

        from stores.topics import publish, get_topic
        publish("publish-test", "core-module")

        topic = get_topic("publish-test")
        self.assertEqual(topic["status"], "published")
        self.assertEqual(topic["wiki_module"], "core-module")


if __name__ == "__main__":
    unittest.main()
