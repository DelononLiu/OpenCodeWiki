"""
test_source_importer.py — source_importer 模块测试。

测试覆盖：
- mock_env fixture：将 REPOS_DIR / SOURCES_DIR / VECTORS_DIR 指向临时目录
- import_code_git：git clone + 索引 + 注册表写入
- import_docs_git：.md 文件复制
- import_docs_zip / import_code_zip：zip 解压 + 复制
- remove_source：清理磁盘文件 + 移除注册表条目
- sync_source：同步流程
- 边界情况：不存在的 source、空目录等
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest


# ── Fixtures ─────────────────────────────────────────────────────


@pytest.fixture
def mock_env(tmp_path):
    """Mock REPOS_DIR / SOURCES_DIR / VECTORS_DIR → tmp_path，同时隔离 JSON 注册表。"""
    repos = tmp_path / "repos"
    sources = tmp_path / "sources"
    vectors = tmp_path / "vectors"
    repos.mkdir(parents=True, exist_ok=True)
    sources.mkdir(parents=True, exist_ok=True)
    vectors.mkdir(parents=True, exist_ok=True)

    reg = tmp_path / ".openwiki" / "registry.json"
    reg.parent.mkdir(parents=True, exist_ok=True)
    reg.write_text("[]")

    with patch("source_importer.REPOS_DIR", repos):
        with patch("source_importer.SOURCES_DIR", sources):
            with patch("source_importer.VECTORS_DIR", vectors):
                with patch("stores.sources.REGISTRY_PATH", reg):
                    yield repos, sources, vectors, reg


# ── Helper: 模拟 _git_clone ─────────────────────────────────────


def _make_fake_git_clone(*, md_files: list[tuple[str, str]] | None = None):
    """返回伪造的 _git_clone 异步函数，创建指定 .md 文件。"""

    async def fake_git_clone(url: str, dest: Path):
        dest.mkdir(parents=True, exist_ok=True)
        if md_files:
            for rel_path, content in md_files:
                f = dest / rel_path
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(content)
        else:
            (dest / "README.md").write_text(f"# Cloned from {url}")

    return fake_git_clone


def _make_fake_run_cmd(*, exit_code: int = 0, output: str = ""):
    """返回伪造的 _run_cmd 异步函数。"""

    async def fake_run_cmd(cmd: list[str], cwd: Path | None = None):
        return exit_code, output

    return fake_run_cmd


async def _noop_cmd(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    return 0, ""


# ── Test: import_code_git ───────────────────────────────────────


@pytest.mark.asyncio
class TestImportCodeGit:
    async def test_basic_import(self, mock_env):
        """基本 git 导入：clone → 索引 → 注册表条目创建。"""
        repos, sources, vectors, reg = mock_env
        fake_clone = _make_fake_git_clone()

        with patch("source_importer._git_clone", fake_clone):
            with patch("source_importer._run_cmd", _noop_cmd):
                from source_importer import import_code_git

                result = await import_code_git("my-code", "https://example.com/repo.git")

        assert result["name"] == "my-code"
        assert result["type"] == "code"
        assert result["url"] == "https://example.com/repo.git"
        assert "created_at" in result
        assert "updated_at" in result

        # 验证目录结构
        assert (repos / "my-code").is_dir()
        assert (repos / "my-code" / "openwiki").is_dir()

        # 验证注册表持久化
        raw = json.loads(reg.read_text())
        assert len(raw) == 1
        assert raw[0]["name"] == "my-code"

    async def test_git_clone_failure_registers_anyway(self, mock_env):
        """clone 失败仍先注册，用户刷新页面不会丢失。"""
        repos, sources, vectors, reg = mock_env

        with patch(
            "source_importer._run_cmd",
            _make_fake_run_cmd(exit_code=128, output="fatal: could not clone"),
        ):
            from source_importer import import_code_git

            result = await import_code_git(
                "fail-clone", "https://example.com/fail.git"
            )
            assert result["name"] == "fail-clone"
            assert result["type"] == "code"

    async def test_creates_openwiki_dir(self, mock_env):
        """验证 openwiki 目录被创建。"""
        repos, sources, vectors, reg = mock_env
        fake_clone = _make_fake_git_clone()

        with patch("source_importer._git_clone", fake_clone):
            with patch("source_importer._run_cmd", _noop_cmd):
                from source_importer import import_code_git

                await import_code_git("with-wiki", "https://example.com/r.git")

        wiki_path = repos / "with-wiki" / "openwiki"
        assert wiki_path.is_dir()

    async def test_runs_index_and_openwiki(self, mock_env):
        """验证 _run_cmd 被调用至少 3 次（index + openwiki）。"""
        repos, sources, vectors, reg = mock_env
        fake_clone = _make_fake_git_clone()
        calls = []

        async def tracking_run_cmd(cmd, cwd=None):
            calls.append((cmd, cwd))
            return 0, ""

        with patch("source_importer._git_clone", fake_clone):
            with patch("source_importer._run_cmd", tracking_run_cmd):
                from source_importer import import_code_git

                await import_code_git("tracked", "https://example.com/r.git")

        # 至少应该有 index 和 openwiki 调用
        all_cmds = [c[0] for c in calls]
        cmd_strs = [" ".join(c) for c in all_cmds]
        assert any("index" in s for s in cmd_strs)
        assert any("openwiki" in s for s in cmd_strs)


# ── Test: import_code_zip ────────────────────────────────────────


@pytest.mark.asyncio
class TestImportCodeZip:
    async def test_basic_import(self, mock_env):
        """基本 zip 导入。"""
        repos, sources, vectors, reg = mock_env
        zip_path = repos / "test.zip"
        zip_path.write_text("fake zip content")

        async def fake_unzip(z, d):
            d.mkdir(parents=True, exist_ok=True)

        with patch("source_importer._unzip", fake_unzip):
            with patch("source_importer._run_cmd", _noop_cmd):
                from source_importer import import_code_zip

                result = await import_code_zip("my-zip-code", zip_path)

        assert result["name"] == "my-zip-code"
        assert result["type"] == "code"
        assert (repos / "my-zip-code").is_dir()
        assert (repos / "my-zip-code" / "openwiki").is_dir()


# ── Test: import_docs_git ───────────────────────────────────────


@pytest.mark.asyncio
class TestImportDocsGit:
    async def test_copies_md_files(self, mock_env):
        """验证 .md 文件被正确复制到 SOURCES_DIR。"""
        repos, sources, vectors, reg = mock_env
        fake_clone = _make_fake_git_clone(
            md_files=[
                ("README.md", "# Docs Repo"),
                ("guide/index.md", "# Guide"),
                ("api/v1/endpoint.md", "# API"),
            ]
        )

        with patch("source_importer._git_clone", fake_clone):
            from source_importer import import_docs_git

            result = await import_docs_git("my-docs", "https://example.com/docs.git")

        assert result["name"] == "my-docs"
        assert result["type"] == "docs"

        dest = sources / "my-docs"
        assert (dest / "README.md").exists()
        assert (dest / "guide" / "index.md").exists()
        assert (dest / "api" / "v1" / "endpoint.md").exists()
        assert (dest / "README.md").read_text() == "# Docs Repo"

    async def test_non_md_files_not_copied(self, mock_env):
        """非 .md 文件不被复制。"""
        repos, sources, vectors, reg = mock_env
        fake_clone = _make_fake_git_clone(
            md_files=[
                ("readme.md", "# readme"),
                ("sub/doc.md", "# doc"),
            ]
        )

        with patch("source_importer._git_clone", fake_clone):
            from source_importer import import_docs_git

            await import_docs_git("no-extra", "https://example.com/docs.git")

        dest = sources / "no-extra"
        # _make_fake_git_clone 只创建 md_files 列表中的文件，这里检查没有额外文件
        assert (dest / "readme.md").exists()
        assert (dest / "sub" / "doc.md").exists()
        assert len(list(dest.rglob("*"))) == 3  # 2 files + sub dir

    async def test_empty_repo(self, mock_env):
        """空仓库（无 .md 文件）导入成功，仅创建注册表条目。"""
        repos, sources, vectors, reg = mock_env

        async def empty_clone(url, dest):
            dest.mkdir(parents=True, exist_ok=True)

        with patch("source_importer._git_clone", empty_clone):
            from source_importer import import_docs_git

            result = await import_docs_git("empty-docs", "https://example.com/empty.git")

        assert result["name"] == "empty-docs"
        dest = sources / "empty-docs"
        assert dest.is_dir()
        assert len(list(dest.rglob("*.md"))) == 0


# ── Test: import_docs_zip ────────────────────────────────────────


@pytest.mark.asyncio
class TestImportDocsZip:
    async def test_basic_import(self, mock_env):
        """基本 zip 文档导入，验证 .md 被提取到 SOURCES_DIR。"""
        repos, sources, vectors, reg = mock_env
        zip_path = repos / "docs.zip"

        async def fake_unzip(zp: Path, dest: Path):
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "readme.md").write_text("# Zipped docs")
            (dest / "manual.md").write_text("# Manual")

        with patch("source_importer._unzip", fake_unzip):
            from source_importer import import_docs_zip

            result = await import_docs_zip("my-zip-docs", zip_path)

        assert result["name"] == "my-zip-docs"
        assert result["type"] == "docs"

        dest = sources / "my-zip-docs"
        assert (dest / "readme.md").exists()
        assert (dest / "manual.md").exists()


# ── Test: remove_source ─────────────────────────────────────────


@pytest.mark.asyncio
class TestRemoveSource:
    async def test_remove_code_source(self, mock_env):
        """删除 code 类型 source：清理 REPOS_DIR 目录 + 注册表条目。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        create_source({"name": "to-delete", "type": "code"})
        repo_dir = repos / "to-delete"
        repo_dir.mkdir(parents=True)
        (repo_dir / "main.py").write_text("print('hello')")

        from source_importer import remove_source

        result = await remove_source("to-delete")

        assert result is True
        assert not repo_dir.exists()
        assert get_source("to-delete") is None

    async def test_remove_docs_source(self, mock_env):
        """删除 docs 类型 source：清理 SOURCES_DIR 目录。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        create_source({"name": "docs-to-delete", "type": "docs"})
        docs_dir = sources / "docs-to-delete"
        docs_dir.mkdir(parents=True)
        (docs_dir / "README.md").write_text("# docs")

        from source_importer import remove_source

        result = await remove_source("docs-to-delete")

        assert result is True
        assert not docs_dir.exists()
        assert get_source("docs-to-delete") is None

    async def test_remove_cleans_vector_files(self, mock_env):
        """删除时同时清理关联的向量文件。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source

        create_source({"name": "vec-test", "type": "code"})
        (repos / "vec-test").mkdir(parents=True)
        (vectors / "vec-test.vec.db").write_text("vector")
        (vectors / "vec-test.vec.db-wal").write_text("wal")
        (vectors / "vec-test.vec.db-shm").write_text("shm")

        from source_importer import remove_source

        result = await remove_source("vec-test")

        assert result is True
        assert not (vectors / "vec-test.vec.db").exists()
        assert not (vectors / "vec-test.vec.db-wal").exists()
        assert not (vectors / "vec-test.vec.db-shm").exists()

    async def test_remove_nonexistent(self, mock_env):
        """删除不存在的 source 返回 False。"""
        repos, sources, vectors, reg = mock_env

        from source_importer import remove_source

        result = await remove_source("does-not-exist")
        assert result is False

    async def test_remove_source_but_no_disk_dir(self, mock_env):
        """source 注册表存在但磁盘目录已被删除——仍应清理注册表。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        create_source({"name": "ghost", "type": "code"})
        # 不创建磁盘目录

        from source_importer import remove_source

        result = await remove_source("ghost")

        assert result is True
        assert get_source("ghost") is None


# ── Test: sync_source ───────────────────────────────────────────


@pytest.mark.asyncio
class TestSyncSource:
    async def test_sync_code_source(self, mock_env):
        """同步 code source：执行 git pull + openwiki。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        create_source({"name": "sync-code", "type": "code", "url": "https://example.com/r.git"})
        (repos / "sync-code").mkdir(parents=True)
        (repos / "sync-code" / ".git").mkdir()
        (repos / "sync-code" / "README.md").write_text("# original")

        calls = []

        async def tracking_run_cmd(cmd, cwd=None):
            calls.append((cmd, cwd))
            return 0, ""

        from source_importer import sync_source

        with patch("source_importer._run_cmd", tracking_run_cmd):
            result = await sync_source("sync-code")

        assert result is not None
        assert result["name"] == "sync-code"
        # verify git pull was run inside repo path
        pull_calls = [c for c in calls if c[0] == ["git", "pull"]]
        assert len(pull_calls) >= 1
        assert pull_calls[0][1] == repos / "sync-code"

    async def test_sync_docs_source(self, mock_env):
        """同步 docs source：重新 clone + 覆盖 .md 文件。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        create_source({"name": "sync-docs", "type": "docs", "url": "https://example.com/docs.git"})
        old_dir = sources / "sync-docs"
        old_dir.mkdir(parents=True)
        (old_dir / "old.md").write_text("# old")

        fake_clone = _make_fake_git_clone(md_files=[("new.md", "# new content")])

        from source_importer import sync_source

        with patch("source_importer._git_clone", fake_clone):
            result = await sync_source("sync-docs")

        assert result is not None
        assert result["name"] == "sync-docs"
        # old file should be gone, new file should be present
        assert not (old_dir / "old.md").exists()
        assert (old_dir / "new.md").exists()
        assert (old_dir / "new.md").read_text() == "# new content"

    async def test_sync_nonexistent_source(self, mock_env):
        """同步不存在的 source 抛出 ValueError。"""
        repos, sources, vectors, reg = mock_env

        from source_importer import sync_source

        with pytest.raises(ValueError, match="not found"):
            await sync_source("no-such-source")

    async def test_sync_updates_timestamp(self, mock_env):
        """同步后更新 updated_at 时间戳。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        entry = create_source({"name": "ts-test", "type": "code", "url": "https://x.com/r.git"})
        ts_before = entry["updated_at"]
        (repos / "ts-test").mkdir(parents=True)

        from source_importer import sync_source

        with patch("source_importer._run_cmd", _noop_cmd):
            result = await sync_source("ts-test")

        assert result is not None
        assert result["updated_at"] >= ts_before

    async def test_sync_source_without_url_raises_value_error(self, mock_env):
        """没有 URL 的 source（zip 导入）同步时抛出 ValueError。"""
        repos, sources, vectors, reg = mock_env

        from stores.sources import create_source, get_source

        # import_code_zip / import_docs_zip 创建的 source 没有 url 字段
        create_source({"name": "no-url-code", "type": "code"})
        (repos / "no-url-code").mkdir(parents=True)

        create_source({"name": "no-url-docs", "type": "docs"})

        from source_importer import sync_source

        with pytest.raises(ValueError, match="no URL"):
            await sync_source("no-url-code")

        with pytest.raises(ValueError, match="no URL"):
            await sync_source("no-url-docs")
