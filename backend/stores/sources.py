"""
stores/sources.py — 知识源注册表 CRUD 操作层。

管理 ~/.opencodewiki/registry.json 中注册的知识来源条目。
每个来源包含 name、type、url（可选）、created_at、updated_at。
"""

import json
from datetime import datetime, timezone
from pathlib import Path

REGISTRY_PATH = Path.home() / ".opencodewiki" / "registry.json"
REPOS_DIR = Path.home() / ".opencodewiki" / "repos"
SOURCES_DIR = Path.home() / ".opencodewiki" / "pages" / "sources"
VECTORS_DIR = Path.home() / ".opencodewiki" / "vectors"


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
        entry["path"] = str(REPOS_DIR / data["name"])
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
