"""
source_importer.py — 知识源导入流程核心模块。

管理将外部代码仓库 / 文档仓库导入到本地存储的完整流程：
- git clone / zip 解压
- 代码仓库索引 + openwiki 构建
- 文档 Markdown 文件复制
- 同步与删除
"""

import asyncio
import json
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from stores.sources import (
    REPOS_DIR,
    SOURCES_DIR,
    VECTORS_DIR,
    create_source,
    delete_source as delete_registry_entry,
    get_source,
    update_source,
)

OPENWIKI_CLI = "openwiki"


# ── 底层工具 ─────────────────────────────────────────────────────


async def _run_cmd(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    """执行外部命令，返回 (exit_code, combined_output)。"""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, (stdout or b"").decode() + (stderr or b"").decode()


async def _git_clone(url: str, dest: Path):
    """git clone 远程仓库到本地路径。"""
    code, log = await _run_cmd(["git", "clone", "--depth", "1", url, str(dest)])
    if code != 0:
        # 取错误摘要，去掉路径/URL 细节
        brief = log.strip().split("\n")[-1] if log.strip() else "unknown error"
        brief = brief.replace("fatal: ", "").replace("remote: ", "").strip()
        raise RuntimeError(f"clone 失败: {brief[:80]}")


async def _unzip(zip_path: Path, dest: Path):
    """解压 zip 文件到目标目录。"""
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)


def _scan_md(root: Path) -> list[Path]:
    """递归扫描目录下所有 .md 文件，按路径排序。"""
    return sorted(root.rglob("*.md"))


async def _copy_md_files(src: Path, dest: Path):
    """递归复制 src 下的所有 .md 文件到 dest，保持目录结构。"""
    dest.mkdir(parents=True, exist_ok=True)
    for md in _scan_md(src):
        rel = md.relative_to(src)
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(md.read_text(encoding="utf-8"), encoding="utf-8")


# ── 导入流程 ─────────────────────────────────────────────────────


async def import_code_git(name: str, url: str) -> dict:
    """从 git 仓库导入代码知识源。

    - git clone 到 REPOS_DIR / name
    - 调用 codebase-memory-mcp 索引
    - 调用 openwiki 构建 wiki
    - 在注册表中创建记录
    """
    # 先注册，让用户立即看到
    result = create_source({"name": name, "type": "code", "url": url})
    dest = REPOS_DIR / name
    try:
        await _git_clone(url, dest)
        from agent.tools import BINARY
        await _run_cmd([BINARY, "cli", "index", json.dumps({"path": str(dest)})])
        wiki_dir = dest / "openwiki"
        if not wiki_dir.exists():
            wiki_dir.mkdir(parents=True, exist_ok=True)
            await _run_cmd([OPENWIKI_CLI, str(dest)], cwd=dest)
    except Exception:
        if dest.exists():
            shutil.rmtree(dest)
        # 注册成功了但后续失败，保留 registry 记录，删除 clone 的目录
    return result


async def import_code_zip(name: str, zip_path: Path) -> dict:
    """从 zip 文件导入代码知识源。"""
    # 先注册，让用户立即看到
    result = create_source({"name": name, "type": "code"})
    dest = REPOS_DIR / name
    try:
        dest.mkdir(parents=True, exist_ok=True)
        await _unzip(zip_path, dest)
        from agent.tools import BINARY
        await _run_cmd([BINARY, "cli", "index", json.dumps({"path": str(dest)})])
        wiki_dir = dest / "openwiki"
        if not wiki_dir.exists():
            wiki_dir.mkdir(parents=True, exist_ok=True)
            await _run_cmd([OPENWIKI_CLI, str(dest)], cwd=dest)
    except Exception:
        if dest.exists():
            shutil.rmtree(dest)
        # 不抛出——注册已成功，用户能看到该源
    return result


async def import_docs_git(name: str, url: str) -> dict:
    """从 git 仓库导入文档知识源。

    - git clone 到临时目录
    - 复制 .md 文件到 SOURCES_DIR / name
    - 在注册表中创建记录
    """
    with tempfile.TemporaryDirectory() as tmp:
        clone_dir = Path(tmp) / name
        await _git_clone(url, clone_dir)
        await _copy_md_files(clone_dir, SOURCES_DIR / name)

    return create_source({"name": name, "type": "docs", "url": url})


async def import_docs_zip(name: str, zip_path: Path) -> dict:
    """从 zip 文件导入文档知识源。"""
    with tempfile.TemporaryDirectory() as tmp:
        extract_dir = Path(tmp) / name
        await _unzip(zip_path, extract_dir)
        await _copy_md_files(extract_dir, SOURCES_DIR / name)

    return create_source({"name": name, "type": "docs"})


# ── 同步与删除 ───────────────────────────────────────────────────


async def sync_source(name: str) -> dict:
    """同步指定名称的知识源（重新拉取代码 / 重新 clone 文档）。"""
    source = get_source(name)
    if not source:
        raise ValueError(f"Source '{name}' not found")

    url = source.get("url")
    if not url:
        raise ValueError(
            f"Source '{name}' has no URL and cannot be synced"
        )

    now = datetime.now(timezone.utc).isoformat()

    if source.get("type") == "code":
        repo_path = REPOS_DIR / name
        # 如果目录不是完整 git 仓库（如 clone 失败），重新 clone
        git_dir = repo_path / ".git"
        if not git_dir.exists():
            if repo_path.exists():
                shutil.rmtree(repo_path)
            await _git_clone(url, repo_path)
        else:
            # openwiki 可能会改 AGENTS.md，先恢复再 pull
            await _run_cmd(["git", "restore", "."], cwd=repo_path)
            await _run_cmd(["git", "clean", "-fd"], cwd=repo_path)
            code, log = await _run_cmd(["git", "pull", "--ff-only"], cwd=repo_path, env={"GIT_TERMINAL_PROMPT": "0"})
            if code != 0:
                raise RuntimeError(f"git pull 失败: {log[:200]}")
        wiki_dir = repo_path / "openwiki"
        if not wiki_dir.exists():
            wiki_dir.mkdir(parents=True, exist_ok=True)
            await _run_cmd([OPENWIKI_CLI, str(repo_path)], cwd=repo_path)

    elif source.get("type") == "docs":
        with tempfile.TemporaryDirectory() as tmp:
            clone_dir = Path(tmp) / name
            await _git_clone(source["url"], clone_dir)
            dest = SOURCES_DIR / name
            if dest.exists():
                shutil.rmtree(dest)
            await _copy_md_files(clone_dir, dest)

    update_source(name, {"updated_at": now})
    return get_source(name)


async def remove_source(name: str) -> bool:
    """删除知识源：清理磁盘文件 + 移除注册表条目。"""
    source = get_source(name)
    if not source:
        return False

    if source.get("type") == "code":
        repo_path = REPOS_DIR / name
        if repo_path.exists():
            shutil.rmtree(repo_path)

    elif source.get("type") == "docs":
        pages_path = SOURCES_DIR / name
        if pages_path.exists():
            shutil.rmtree(pages_path)

    for vec_file in VECTORS_DIR.glob(f"{name}.vec.db*"):
        vec_file.unlink(missing_ok=True)

    return delete_registry_entry(name)
