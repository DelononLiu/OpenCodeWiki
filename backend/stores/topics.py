"""
store_topics.py — Topic 聚合层 CRUD.
QA → Topic 聚合 → Draft 提炼 → Wiki 沉淀
"""

from datetime import datetime, timezone

from database import get_knowledge_db


def list_topics(status: str | None = None) -> list[dict]:
    db = get_knowledge_db()
    if status:
        rows = db.execute("SELECT * FROM topics WHERE status = ? ORDER BY created_at DESC", (status,))
    else:
        rows = db.execute("SELECT * FROM topics ORDER BY created_at DESC")
    topics = [dict(r) for r in rows.fetchall()]
    for t in topics:
        cnt = db.execute("SELECT COUNT(*) AS c FROM topic_qa WHERE topic_slug = ?", (t["slug"],)).fetchone()
        t["qa_count"] = cnt["c"]
    return topics


def get_topic(slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topics WHERE slug = ?", (slug,)).fetchone()
    if not row:
        return None
    topic = dict(row)
    # Try to load QA entries — may fail if qa.db not initialized
    try:
        from database import get_qa_db
        qa_db = get_qa_db()
        qa_rows = db.execute(
            """SELECT q.qid, q.question, q.answer, q.created_at
               FROM topic_qa tq JOIN qa_entries q ON q.qid = tq.qid
               WHERE tq.topic_slug = ? ORDER BY q.created_at DESC""",
            (slug,),
        ).fetchall()
        topic["qa_entries"] = [dict(r) for r in qa_rows]
    except Exception:
        topic["qa_entries"] = []
    return topic


def create_topic(slug: str, name: str, description: str = "") -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT OR IGNORE INTO topics (slug, name, description, status, created_at) VALUES (?, ?, ?, 'pool', ?)",
        (slug, name, description, now),
    )
    db.commit()
    return {"slug": slug, "name": name, "status": "pool"}


def link_qa(topic_slug: str, qid: int):
    db = get_knowledge_db()
    db.execute("INSERT OR IGNORE INTO topic_qa (topic_slug, qid) VALUES (?, ?)", (topic_slug, qid))
    db.commit()


def save_draft(topic_slug: str, raw_content: str) -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT OR REPLACE INTO topic_drafts
           (topic_slug, raw_content, status, created_at)
           VALUES (?, ?, 'pending', ?)""",
        (topic_slug, raw_content, now),
    )
    db.commit()
    return {"topic_slug": topic_slug, "status": "pending"}


def get_draft(topic_slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topic_drafts WHERE topic_slug = ?", (topic_slug,)).fetchone()
    return dict(row) if row else None


def approve_draft(topic_slug: str, reviewer: str = "admin") -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'approved', reviewer = ?, reviewed_at = ? WHERE topic_slug = ?",
        (reviewer, now, topic_slug),
    )
    db.commit()
    return True


def update_draft_content(topic_slug: str, edited_content: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET edited_content = ?, updated_at = ? WHERE topic_slug = ?",
        (edited_content, now, topic_slug),
    )
    db.commit()
    return True


def publish(topic_slug: str, wiki_module: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topics SET status = 'published', wiki_module = ?, published_at = ? WHERE slug = ?",
        (wiki_module, now, topic_slug),
    )
    db.commit()
    return True


def search_topics(q: str, limit: int = 3) -> list[dict]:
    db = get_knowledge_db()
    rows = db.execute(
        "SELECT slug, name, description FROM topics WHERE slug LIKE ? OR name LIKE ? LIMIT ?",
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]
