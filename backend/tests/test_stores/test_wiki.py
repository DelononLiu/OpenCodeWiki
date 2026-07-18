"""
test_wiki.py — Wiki 页面文件操作层测试

测试 stores.wiki 模块全部 4 个函数。
使用 tmp_path fixture 隔离文件操作，不碰真实用户目录。
"""

import pytest
from pathlib import Path
from unittest.mock import patch


@pytest.fixture
def mock_wiki_dir(tmp_path):
    """将 Wiki PAGES_DIR 重定向到临时目录"""
    pages_dir = tmp_path / ".opencodewiki" / "pages"
    pages_dir.mkdir(parents=True)
    with patch("stores.wiki.PAGES_DIR", pages_dir):
        yield pages_dir


class TestWritePage:
    def test_write_entity(self, mock_wiki_dir):
        """写入 entity 类型页面"""
        from stores.wiki import write_page

        path = write_page("test-slug", "entity", "# 测试内容")
        assert path.exists()
        assert path.read_text(encoding="utf-8") == "# 测试内容"
        assert "entities" in str(path)

    def test_write_overview(self, mock_wiki_dir):
        """写入 overview 类型页面"""
        from stores.wiki import write_page

        path = write_page("overview-slug", "overview", "## 概览")
        assert path.exists()
        assert "overviews" in str(path)

    def test_write_qa_archive(self, mock_wiki_dir):
        """写入 qa-archive 类型页面"""
        from stores.wiki import write_page

        path = write_page("qa-slug", "qa-archive", "归档内容")
        assert path.exists()
        assert "qa-archives" in str(path)

    def test_write_overwrite(self, mock_wiki_dir):
        """重复写入覆盖旧内容"""
        from stores.wiki import write_page

        write_page("overwrite-test", "entity", "旧内容")
        write_page("overwrite-test", "entity", "新内容")

        content = (mock_wiki_dir / "entities" / "overwrite-test.md").read_text(encoding="utf-8")
        assert content == "新内容"


class TestReadPage:
    def test_read_existing(self, mock_wiki_dir):
        """读取存在的页面"""
        from stores.wiki import write_page, read_page

        write_page("read-test", "entity", "# 可读内容")
        content = read_page("read-test", "entity")
        assert content == "# 可读内容"

    def test_read_nonexistent(self, mock_wiki_dir):
        """读取不存在的页面返回 None"""
        from stores.wiki import read_page

        assert read_page("not-exist", "entity") is None

    def test_read_wrong_type(self, mock_wiki_dir):
        """读取错误的类型返回 None"""
        from stores.wiki import write_page, read_page

        write_page("type-test", "entity", "内容")
        assert read_page("type-test", "overview") is None


class TestListPages:
    def test_list_all(self, mock_wiki_dir):
        """列出所有页面"""
        from stores.wiki import write_page, list_pages

        write_page("page-a", "entity", "A")
        write_page("page-b", "entity", "B")
        write_page("overview-c", "overview", "C")

        pages = list_pages()
        slugs = [p["slug"] for p in pages]
        assert "page-a" in slugs
        assert "page-b" in slugs
        assert "overview-c" in slugs

    def test_list_by_type(self, mock_wiki_dir):
        """按类型筛选页面"""
        from stores.wiki import write_page, list_pages

        write_page("entity-1", "entity", "E1")
        write_page("entity-2", "entity", "E2")
        write_page("overview-1", "overview", "O1")

        entities = list_pages("entity")
        assert len(entities) == 2

        overviews = list_pages("overview")
        assert len(overviews) == 1

    def test_list_empty(self, mock_wiki_dir):
        """空目录返回空列表"""
        from stores.wiki import list_pages

        pages = list_pages()
        assert pages == []


class TestPagePath:
    def test_entity_path(self, mock_wiki_dir):
        """entity 类型路径正确"""
        from stores.wiki import page_path

        path = page_path("my-entity", "entity")
        assert path.name == "my-entity.md"
        assert "entities" in str(path)

    def test_default_type(self, mock_wiki_dir):
        """默认类型为 entity"""
        from stores.wiki import page_path

        path = page_path("default")  # 不传 page_type
        assert "entities" in str(path)
