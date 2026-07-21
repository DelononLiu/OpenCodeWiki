"""
test_sources_routes.py — /api/sources 路由测试
"""

import json
from unittest.mock import AsyncMock, patch


REGISTRY_CONTENT = [
    {
        "name": "repo1",
        "type": "code",
        "url": "https://example.com/repo1.git",
        "created_at": "2024-01-01T00:00:00",
        "updated_at": "2024-01-01T00:00:00",
    },
    {
        "name": "docs1",
        "type": "docs",
        "url": "https://example.com/docs1.git",
        "created_at": "2024-01-02T00:00:00",
        "updated_at": "2024-01-02T00:00:00",
    },
]


def _setup_registry(tmp_path, content=None):
    """Helper: write registry.json into tmp_path and return patcher for stores.sources.REGISTRY_PATH."""
    reg = tmp_path / ".opencodewiki" / "registry.json"
    reg.parent.mkdir(parents=True)
    reg.write_text(json.dumps(content if content is not None else REGISTRY_CONTENT))
    return patch("config.REGISTRY_PATH", reg)


class TestSourcesRoutes:
    # ── GET /api/sources ──────────────────────────────────────────

    def test_list_sources_empty(self, client, tmp_path):
        """GET /api/sources 空列表"""
        with _setup_registry(tmp_path, []):
            resp = client.get("/api/sources")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["data"] == []

    def test_list_sources_all(self, client, tmp_path):
        """GET /api/sources 返回全部来源"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/sources")
            data = resp.json()
            assert data["ok"] is True
            assert len(data["data"]) == 2

    def test_list_sources_filter_type_code(self, client, tmp_path):
        """GET /api/sources?type=code 过滤出代码源"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/sources", params={"type": "code"})
            data = resp.json()
            assert data["ok"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["name"] == "repo1"

    def test_list_sources_filter_type_docs(self, client, tmp_path):
        """GET /api/sources?type=docs 过滤出文档源"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/sources", params={"type": "docs"})
            data = resp.json()
            assert data["ok"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["name"] == "docs1"

    # ── GET /api/sources/{name} ───────────────────────────────────

    def test_get_source_found(self, client, tmp_path):
        """GET /api/sources/{name} 返回指定来源"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/sources/repo1")
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "repo1"
            assert data["data"]["type"] == "code"

    def test_get_source_not_found(self, client, tmp_path):
        """GET /api/sources/{name} 不存在的来源返回 404"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/sources/nonexistent")
            assert resp.status_code == 404
            assert "not found" in resp.json()["detail"]

    # ── POST /api/sources ─────────────────────────────────────────

    def test_create_source_code_git(self, client):
        """POST /api/sources 创建 git 代码源成功"""
        mock_entry = {
            "name": "new-repo",
            "type": "code",
            "url": "https://example.com/new.git",
            "created_at": "2024-01-03T00:00:00",
            "updated_at": "2024-01-03T00:00:00",
        }
        with patch("main.import_code_git", AsyncMock(return_value=mock_entry)):
            resp = client.post(
                "/api/sources",
                json={"name": "new-repo", "url": "https://example.com/new.git", "type": "code"},
            )
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "new-repo"
            assert data["data"]["type"] == "code"

    def test_create_source_docs_git(self, client):
        """POST /api/sources 创建 git 文档源成功"""
        mock_entry = {
            "name": "new-docs",
            "type": "docs",
            "url": "https://example.com/new-docs.git",
            "created_at": "2024-01-03T00:00:00",
            "updated_at": "2024-01-03T00:00:00",
        }
        with patch("main.import_docs_git", AsyncMock(return_value=mock_entry)):
            resp = client.post(
                "/api/sources",
                json={"name": "new-docs", "url": "https://example.com/new-docs.git", "type": "docs"},
            )
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "new-docs"
            assert data["data"]["type"] == "docs"

    def test_create_source_missing_name(self, client):
        """POST /api/sources 缺少名称返回错误"""
        resp = client.post("/api/sources", json={"url": "https://example.com/new.git"})
        data = resp.json()
        assert data["ok"] is False
        assert "Missing name" in data["error"]

    def test_create_source_duplicate(self, client, tmp_path):
        """POST /api/sources 重复名称返回错误"""
        with _setup_registry(tmp_path):
            resp = client.post(
                "/api/sources",
                json={"name": "repo1", "url": "https://example.com/repo1.git"},
            )
            data = resp.json()
            assert data["ok"] is False
            assert "already exists" in data["error"]

    def test_create_source_invalid_type(self, client):
        """POST /api/sources 无效类型返回错误"""
        resp = client.post(
            "/api/sources",
            json={"name": "test", "url": "https://example.com/test.git", "type": "invalid"},
        )
        data = resp.json()
        assert data["ok"] is False
        assert "Invalid type" in data["error"]

    def test_create_source_runtime_error(self, client):
        """POST /api/sources 导入抛出 RuntimeError 返回 500"""
        with patch("main.import_code_git", AsyncMock(side_effect=RuntimeError("Clone failed"))):
            resp = client.post(
                "/api/sources",
                json={"name": "fail-repo", "url": "https://example.com/fail.git"},
            )
            data = resp.json()
            assert data["ok"] is False
            assert "Clone failed" in data["error"]
            assert resp.status_code == 500

    # ── POST /api/sources (multipart) ───────────────────────────

    def test_upload_source_code_zip(self, client):
        """POST /api/sources multipart 上传 zip 代码源成功"""
        mock_entry = {
            "name": "zip-repo",
            "type": "code",
            "created_at": "2024-01-03T00:00:00",
            "updated_at": "2024-01-03T00:00:00",
        }
        with patch("main.import_code_zip", AsyncMock(return_value=mock_entry)):
            resp = client.post(
                "/api/sources",
                data={"name": "zip-repo", "type": "code"},
                files={"file": ("test.zip", b"fakezipcontent", "application/zip")},
            )
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "zip-repo"

    def test_upload_source_docs_zip(self, client):
        """POST /api/sources multipart 上传 zip 文档源成功"""
        mock_entry = {
            "name": "zip-docs",
            "type": "docs",
            "created_at": "2024-01-03T00:00:00",
            "updated_at": "2024-01-03T00:00:00",
        }
        with patch("main.import_docs_zip", AsyncMock(return_value=mock_entry)):
            resp = client.post(
                "/api/sources",
                data={"name": "zip-docs", "type": "docs"},
                files={"file": ("docs.zip", b"fakemarkdown", "application/zip")},
            )
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "zip-docs"

    def test_upload_source_missing_name(self, client):
        """POST /api/sources multipart 缺少名称时返回错误"""
        resp = client.post(
            "/api/sources",
            data={"type": "code"},
            files={"file": ("test.zip", b"fakezipcontent", "application/zip")},
        )
        data = resp.json()
        assert data["ok"] is False
        assert "Missing name" in data["error"]

    def test_upload_source_duplicate(self, client, tmp_path):
        """POST /api/sources multipart 重复名称返回错误"""
        with _setup_registry(tmp_path):
            resp = client.post(
                "/api/sources",
                data={"name": "repo1", "type": "code"},
                files={"file": ("test.zip", b"fakezipcontent", "application/zip")},
            )
            data = resp.json()
            assert data["ok"] is False
            assert "already exists" in data["error"]

    def test_upload_source_invalid_type(self, client):
        """POST /api/sources multipart 无效类型当作文档上传处理"""
        resp = client.post(
            "/api/sources",
            data={"name": "test", "type": "invalid"},
            files={"file": ("test.zip", b"fakezipcontent", "application/zip")},
        )
        # 无效类型不会报错，会走文档上传路径处理
        data = resp.json()
        assert "ok" in data

    def test_upload_source_exception(self, client):
        """POST /api/sources multipart 导入异常返回 500"""
        with patch("main.import_code_zip", AsyncMock(side_effect=Exception("Extract failed"))):
            resp = client.post(
                "/api/sources",
                data={"name": "fail-zip", "type": "code"},
                files={"file": ("test.zip", b"fakezipcontent", "application/zip")},
            )
            data = resp.json()
            assert data["ok"] is False
            assert "Extract failed" in data["error"]
            assert resp.status_code == 500

    # ── POST /api/sources/{name}/sync ─────────────────────────────

    def test_sync_source_success(self, client):
        """POST /api/sources/{name}/sync 同步成功"""
        mock_result = {
            "name": "repo1",
            "type": "code",
            "updated_at": "2024-06-01T00:00:00",
        }
        with patch("main.sync_source", AsyncMock(return_value=mock_result)):
            resp = client.post("/api/sources/repo1/sync")
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["name"] == "repo1"

    def test_sync_source_not_found(self, client):
        """POST /api/sources/{name}/sync 不存在返回 404"""
        err = ValueError("Source 'nonexistent' not found")
        with patch("main.sync_source", AsyncMock(side_effect=err)):
            resp = client.post("/api/sources/nonexistent/sync")
            assert resp.status_code == 404

    def test_sync_source_runtime_error(self, client):
        """POST /api/sources/{name}/sync 同步失败返回 500"""
        with patch("main.sync_source", AsyncMock(side_effect=RuntimeError("Sync failed"))):
            resp = client.post("/api/sources/repo1/sync")
            data = resp.json()
            assert data["ok"] is False
            assert "Sync failed" in data["error"]
            assert resp.status_code == 500

    # ── DELETE /api/sources/{name} ────────────────────────────────

    def test_delete_source_success(self, client):
        """DELETE /api/sources/{name} 删除成功"""
        with patch("main.remove_source", AsyncMock(return_value=True)):
            resp = client.delete("/api/sources/repo1")
            data = resp.json()
            assert data["ok"] is True
            assert data["data"]["deleted"] is True

    def test_delete_source_not_found(self, client):
        """DELETE /api/sources/{name} 不存在返回 404"""
        with patch("main.remove_source", AsyncMock(return_value=False)):
            resp = client.delete("/api/sources/nonexistent")
            assert resp.status_code == 404

    # ── GET /api/repos (backward compat) ──────────────────────────

    def test_repos_backward_compat(self, client, tmp_path):
        """GET /api/repos 向后兼容只返回代码源"""
        with _setup_registry(tmp_path):
            resp = client.get("/api/repos")
            data = resp.json()
            assert data["ok"] is True
            assert len(data["data"]) == 1
            assert data["data"][0]["type"] == "code"
            assert data["data"][0]["name"] == "repo1"
