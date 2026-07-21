"""
stores/sources.py — 知识源注册表 CRUD 操作层。

管理 ~/.opencodewiki/registry.json 中注册的知识来源条目。
每个来源包含 name、type、url（可选）、created_at、updated_at。
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import REGISTRY_PATH, KNOWLEDGE_DIR, VECTORS_DIR


def svn_checkout(url: str, dest: Path, username: str = "", password: str = "") -> str:
    """执行 svn checkout，返回 stdout/stderr。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["svn", "checkout", url, str(dest)]
    if username:
        cmd.extend(["--username", username])
    if password:
        cmd.extend(["--password", password])
    cmd.extend(["--non-interactive", "--trust-server-cert-fail-unknown-ca"])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"svn checkout failed (exit {result.returncode}): {result.stderr[:500]}")
        return result.stdout
    except FileNotFoundError:
        raise RuntimeError("svn binary not found — install subversion (apt install subversion)")


def _read() -> list[dict]:
    """读取注册表 JSON，文件不存在或格式错误返回空列表。"""
    try:
        return json.loads(REGISTRY_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write(data: list[dict]):
    """写入注册表 JSON，自动创建父目录。"""
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def sync_registry(dry_run: bool = False) -> list[dict]:
    """扫描 KNOWLEDGE_DIR，把有目录但没注册的自动补上注册条目。

    这是修复 registry ↔ 目录不一致的核心方法。
    自动识别类型：含 .git 的标记为 code，其余标记为 docs。
    返回本次新增的条目列表。dry_run=True 只返回待新增条目，不实际写入。
    """
    if not KNOWLEDGE_DIR.exists():
        return []

    registered = {e["name"] for e in _read()}
    now = datetime.now(timezone.utc).isoformat()
    new_entries = []

    for entry in sorted(KNOWLEDGE_DIR.iterdir()):
        if not entry.is_dir() or entry.name in registered:
            continue

        guessed_type = "code" if (entry / ".git").exists() else "docs"
        new_entry = {
            "name": entry.name,
            "type": guessed_type,
            "path": str(entry),
            "created_at": now,
            "updated_at": now,
        }
        if not dry_run:
            create_source(new_entry)
            print(f"[sync] 自动注册未记录的知识库: {entry.name} ({guessed_type})", file=sys.stderr)
        new_entries.append(new_entry)

    return new_entries


def list_sources(type: str | None = None) -> list[dict]:
    """列出所有注册的来源，可按 type 筛选。"""
    sources = _read()
    if type:
        return [s for s in sources if s.get("type") == type]
    return sources


def get_source(name: str) -> dict | None:
    """按 name 查找来源，不存在返回 None。"""
    for s in _read():
        if s["name"] == name:
            return s
    return None


def create_source(data: dict) -> dict:
    """创建新的来源条目，返回包含时间戳的完整条目。"""
    sources = _read()
    now = datetime.now(timezone.utc).isoformat()
    entry = {"name": data["name"], "type": data.get("type", "code")}
    if data.get("url"):
        entry["url"] = data["url"]
    if data.get("path"):
        entry["path"] = data["path"]
    elif data.get("type") == "code":
        entry["path"] = str(KNOWLEDGE_DIR / data["name"])
    elif data.get("type") == "svn":
        entry["path"] = str(KNOWLEDGE_DIR / data["name"])
        if data.get("svn_url"):
            entry["svn_url"] = data["svn_url"]
        if data.get("encrypted_password"):
            entry["encrypted_password"] = data["encrypted_password"]
        if data.get("username"):
            entry["username"] = data["username"]
    entry["created_at"] = now
    entry["updated_at"] = now
    sources.append(entry)
    _write(sources)
    return entry


def delete_source(name: str) -> bool:
    """按 name 删除来源，成功返回 True，不存在返回 False。"""
    sources = _read()
    for i, s in enumerate(sources):
        if s["name"] == name:
            sources.pop(i)
            _write(sources)
            return True
    return False


def update_source(name: str, data: dict) -> dict | None:
    """更新来源条目（仅允许更新 mutable 字段），返回更新后的条目，不存在返回 None。"""
    # 保护不可变字段不被误覆盖
    data.pop("name", None)
    data.pop("created_at", None)
    sources = _read()
    for s in sources:
        if s["name"] == name:
            s.update(data)
            s["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write(sources)
            return s
    return None
