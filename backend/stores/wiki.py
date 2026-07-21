"""
store_wiki.py — Wiki 页面文件操作层。
读取/写入 .md 文件到 ~/.opencodewiki/pages/ 目录。
"""

import re
from datetime import datetime, timezone
from pathlib import Path

PAGES_DIR = Path.home() / ".opencodewiki" / "pages"

_TYPE_DIRS = {
    "entity": "entities",
    "overview": "overviews",
    "qa-archive": "qa-archives",
}


def _ensure_dirs():
    for d in _TYPE_DIRS.values():
        (PAGES_DIR / d).mkdir(parents=True, exist_ok=True)


def page_path(slug: str, page_type: str = "entity") -> Path:
    sub = _TYPE_DIRS.get(page_type, "entities")
    return PAGES_DIR / sub / f"{slug}.md"


def read_page(slug: str, page_type: str = "entity") -> str | None:
    path = page_path(slug, page_type)
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def write_page(slug: str, page_type: str, content: str, kb_name: str = "") -> Path:
    _ensure_dirs()
    path = page_path(slug, page_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

    # Sync to wiki_modules table
    _upsert_module(slug, page_type, content, kb_name)

    return path


def _upsert_module(slug: str, page_type: str, content: str = "", kb_name: str = "") -> None:
    """将页面信息写入 wiki_modules 表，方便快速列出。"""
    from database import get_qa_db
    db = get_qa_db()
    title = _extract_h1(content) if content else slug.split("/")[-1]
    existing_kb = ""
    if not kb_name:
        existing = db.execute("SELECT kb_name FROM wiki_modules WHERE slug = ?", (slug,)).fetchone()
        existing_kb = (existing["kb_name"] or "") if existing else ""
    final_kb = kb_name or existing_kb
    display_name = f"{final_kb} / {title}" if final_kb else title
    db.execute(
        """INSERT OR REPLACE INTO wiki_modules (slug, name, type, title, kb_name, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))""",
        (slug, display_name, page_type, title, final_kb),
    )
    db.commit()


def _extract_h1(content: str) -> str | None:
    m = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return m.group(1).strip() if m else None


def sync_wiki_modules(knowledge_modules: list[dict] | None = None) -> None:
    """全量同步 wiki_modules 表。
    - 从 pages/ 目录扫描存储的 wiki 页面
    - 合并传入的 knowledge source 模块列表
    """
    from database import get_qa_db
    db = get_qa_db()

    # 保存已有的 kb_name 映射
    old_kb = {}
    for row in db.execute("SELECT slug, kb_name FROM wiki_modules WHERE kb_name != ''").fetchall():
        old_kb[row["slug"]] = row["kb_name"]

    # 清空后重建
    db.execute("DELETE FROM wiki_modules")

    # 1. Stored wiki pages
    for p in list_pages():
        title = p["slug"].split("/")[-1]
        try:
            content = read_page(p["slug"], p["page_type"])
            if content:
                h1 = _extract_h1(content)
                if h1:
                    title = h1
        except Exception:
            pass
        kb = old_kb.get(p["slug"], "")
        display_name = f"{kb} / {title}" if kb else title
        db.execute(
            "INSERT INTO wiki_modules (slug, name, type, title, kb_name) VALUES (?, ?, ?, ?, ?)",
            (p["slug"], display_name, p["page_type"], title, kb),
        )

    # 2. Knowledge source modules (from main.py)
    if knowledge_modules:
        seen = {p["slug"] for p in list_pages()}
        for m in knowledge_modules:
            if m["slug"] in seen:
                continue
            seen.add(m["slug"])
            db.execute(
                "INSERT INTO wiki_modules (slug, name, type, title, kb_name) VALUES (?, ?, ?, ?, ?)",
                (m["slug"], m["name"], m["type"], m.get("title", ""), m.get("kb_name", "")),
            )

    db.commit()


def index_wiki_page(slug: str, content: str) -> None:
    """将 Wiki 页面分块写入 FTS5 wiki_index 表。"""
    from database import get_qa_db

    db = get_qa_db()

    # 删除旧索引
    db.execute("DELETE FROM wiki_index WHERE slug = ?", (slug,))

    # 按段落分块（以 ## 为界）
    chunks = re.split(r"\n(?=## )", content)
    now = datetime.now(timezone.utc).isoformat()

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk or len(chunk) < 20:
            continue
        # 提取关键词：取 chunk 的第一行（去掉 ## 前缀）
        first_line = chunk.split("\n")[0].lstrip("# ").strip()
        keywords = first_line
        db.execute(
            "INSERT INTO wiki_index (slug, chunk_text, keywords, published_at) VALUES (?, ?, ?, ?)",
            (slug, chunk, keywords, now),
        )
    db.commit()


def search_wiki_index(query: str, limit: int = 3) -> list[dict]:
    """FTS5 搜索 wiki_index，返回匹配的 chunk。"""
    from database import get_qa_db

    db = get_qa_db()
    try:
        rows = db.execute(
            "SELECT slug, chunk_text, keywords, rank FROM wiki_index WHERE wiki_index MATCH ? ORDER BY rank LIMIT ?",
            (query, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def list_conversions() -> list[dict]:
    """查询 wiki_conversions 表，返回按时间倒序的转换记录。"""
    from database import get_qa_db

    db = get_qa_db()
    try:
        rows = db.execute(
            "SELECT * FROM wiki_conversions ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def delete_conversion(conv_id: str) -> bool:
    """删除转换记录（同时清理 wiki 文件和索引）。"""
    from database import get_qa_db

    db = get_qa_db()
    row = db.execute("SELECT wiki_slug FROM wiki_conversions WHERE id = ?", (conv_id,)).fetchone()
    if not row:
        return False

    slug = row["wiki_slug"]

    # 删 wiki 文件
    try:
        for pt in ("qa-archive", "entity", "overview"):
            p = page_path(slug, pt)
            if p.exists():
                p.unlink()
    except Exception:
        pass

    # 删 FTS 索引
    try:
        db.execute("DELETE FROM wiki_index WHERE slug = ?", (slug,))
    except Exception:
        pass

    # 删 wiki_modules 记录
    try:
        db.execute("DELETE FROM wiki_modules WHERE slug = ?", (slug,))
    except Exception:
        pass

    # 删转换记录
    db.execute("DELETE FROM wiki_conversions WHERE id = ?", (conv_id,))
    db.commit()
    return True


def list_pages(page_type: str | None = None) -> list[dict]:
    _ensure_dirs()
    pages = []
    dirs = [PAGES_DIR / d for d in _TYPE_DIRS.values()] if page_type is None else [PAGES_DIR / _TYPE_DIRS[page_type]]
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.rglob("*.md")):
            try:
                rel = f.relative_to(d)
            except ValueError:
                rel = f
            slug = str(rel.with_suffix('')).replace("\\", "/")
            pages.append({
                "slug": slug,
                "page_type": next((k for k, v in _TYPE_DIRS.items() if v == d.name), "entity"),
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    return pages
