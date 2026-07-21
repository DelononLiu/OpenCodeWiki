"""
store_wiki.py — Wiki 页面文件操作层。
读取/写入 .md 文件到 ~/.opencodewiki/pages/ 目录。
"""

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


def write_page(slug: str, page_type: str, content: str) -> Path:
    _ensure_dirs()
    path = page_path(slug, page_type)
    path.write_text(content, encoding="utf-8")
    return path


def index_wiki_page(slug: str, content: str):
    """Index a wiki page into FTS5 for full-text search."""
    from database import get_qa_db

    db = get_qa_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute("DELETE FROM wiki_index WHERE slug = ?", (slug,))
    db.execute(
        "INSERT INTO wiki_index (slug, chunk_text, keywords, published_at) VALUES (?, ?, '', ?)",
        (slug, content, now),
    )
    db.commit()


def list_pages(page_type: str | None = None) -> list[dict]:
    _ensure_dirs()
    pages = []
    dirs = [PAGES_DIR / d for d in _TYPE_DIRS.values()] if page_type is None else [PAGES_DIR / _TYPE_DIRS[page_type]]
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            pages.append({
                "slug": f.stem,
                "page_type": next((k for k, v in _TYPE_DIRS.items() if v == d.name), "entity"),
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    return pages
