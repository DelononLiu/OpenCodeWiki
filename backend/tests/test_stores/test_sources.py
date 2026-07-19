"""
test_sources.py — 知识源注册表 CRUD 操作测试

测试 stores.sources 模块全部 5 个函数。
使用 tmp_path fixture 隔离 JSON 文件操作，不碰真实用户目录。
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def mock_registry(tmp_path):
    """将 REGISTRY_PATH 重定向到临时目录"""
    reg = tmp_path / ".opencodewiki" / "registry.json"
    reg.parent.mkdir(parents=True)
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        yield reg


class TestListSources:
    def test_list_empty(self, mock_registry):
        """空注册表返回空列表"""
        from stores.sources import list_sources

        assert list_sources() == []

    def test_list_all(self, mock_registry):
        """列出所有来源"""
        from stores.sources import create_source, list_sources

        create_source({"name": "src-a", "type": "code"})
        create_source({"name": "src-b", "type": "docs"})

        sources = list_sources()
        assert len(sources) == 2
        names = [s["name"] for s in sources]
        assert "src-a" in names
        assert "src-b" in names

    def test_list_by_type(self, mock_registry):
        """按类型筛选来源"""
        from stores.sources import create_source, list_sources

        create_source({"name": "code-a", "type": "code"})
        create_source({"name": "code-b", "type": "code"})
        create_source({"name": "docs-c", "type": "docs"})

        assert len(list_sources("code")) == 2
        assert len(list_sources("docs")) == 1

    def test_list_type_nonexistent(self, mock_registry):
        """不存在的类型返回空列表"""
        from stores.sources import create_source, list_sources

        create_source({"name": "only-code", "type": "code"})
        assert list_sources("nonexistent") == []


class TestGetSource:
    def test_get_existing(self, mock_registry):
        """获取存在的来源"""
        from stores.sources import create_source, get_source

        create_source({"name": "my-repo", "type": "code"})
        source = get_source("my-repo")
        assert source is not None
        assert source["name"] == "my-repo"
        assert source["type"] == "code"

    def test_get_nonexistent(self, mock_registry):
        """获取不存在的来源返回 None"""
        from stores.sources import get_source

        assert get_source("nope") is None


class TestCreateSource:
    def test_create_basic(self, mock_registry):
        """创建基本来源条目"""
        from stores.sources import create_source

        result = create_source({"name": "new-source", "type": "code"})
        assert result["name"] == "new-source"
        assert result["type"] == "code"
        assert "created_at" in result
        assert "updated_at" in result
        assert "path" in result
        assert result["path"].endswith("/new-source")

    def test_create_with_url(self, mock_registry):
        """创建包含 URL 的来源"""
        from stores.sources import create_source

        result = create_source({"name": "remote", "type": "docs", "url": "https://example.com"})
        assert result["url"] == "https://example.com"

    def test_create_default_type(self, mock_registry):
        """不指定 type 时默认为 code"""
        from stores.sources import create_source

        result = create_source({"name": "default-type"})
        assert result["type"] == "code"

    def test_create_persists(self, mock_registry):
        """创建后数据持久化到 JSON 文件"""
        from stores.sources import create_source

        create_source({"name": "persist-me", "type": "code"})
        raw = json.loads(mock_registry.read_text())
        assert len(raw) == 1
        assert raw[0]["name"] == "persist-me"


class TestDeleteSource:
    def test_delete_existing(self, mock_registry):
        """删除存在的来源返回 True"""
        from stores.sources import create_source, delete_source

        create_source({"name": "del-me", "type": "code"})
        assert delete_source("del-me") is True

    def test_delete_removes_from_list(self, mock_registry):
        """删除后列表为空"""
        from stores.sources import create_source, delete_source, list_sources

        create_source({"name": "del-me", "type": "code"})
        delete_source("del-me")
        assert len(list_sources()) == 0

    def test_delete_nonexistent(self, mock_registry):
        """删除不存在的来源返回 False"""
        from stores.sources import delete_source

        assert delete_source("nope") is False


class TestUpdateSource:
    def test_update_existing(self, mock_registry):
        """更新存在的来源"""
        from stores.sources import create_source, update_source

        create_source({"name": "updatable", "type": "code"})
        result = update_source("updatable", {"url": "https://new-url.com"})
        assert result is not None
        assert result["url"] == "https://new-url.com"

    def test_update_persists(self, mock_registry):
        """更新后数据持久化到 JSON"""
        from stores.sources import create_source, update_source

        create_source({"name": "updatable", "type": "code"})
        update_source("updatable", {"type": "docs"})

        raw = json.loads(mock_registry.read_text())
        assert raw[0]["type"] == "docs"

    def test_update_nonexistent(self, mock_registry):
        """更新不存在的来源返回 None"""
        from stores.sources import update_source

        assert update_source("nope", {"type": "docs"}) is None


class TestConstants:
    def test_repos_dir(self):
        """REPOS_DIR 指向 ~/.opencodewiki/repos"""
        from stores.sources import REPOS_DIR

        assert str(REPOS_DIR).endswith(".opencodewiki/repos")

    def test_sources_dir(self):
        """SOURCES_DIR 指向 ~/.opencodewiki/pages/sources"""
        from stores.sources import SOURCES_DIR

        assert str(SOURCES_DIR).endswith(".opencodewiki/pages/sources")

    def test_vectors_dir(self):
        """VECTORS_DIR 指向 ~/.opencodewiki/vectors"""
        from stores.sources import VECTORS_DIR

        assert str(VECTORS_DIR).endswith(".opencodewiki/vectors")
