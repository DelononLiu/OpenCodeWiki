"""
store_qa.py — QA entry CRUD operations.
Replaces qa-store.ts from Node.js era.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from database import get_qa_db


def get_next_qid() -> int:
    db = get_qa_db()
    row = db.execute("SELECT COALESCE(MAX(qid), 0) + 1 AS next FROM qa_entries").fetchone()
    return row["next"]


def create_entry(data: dict) -> dict:
    db = get_qa_db()
    eid = data.get("id") or str(uuid.uuid4())
    qid = data.get("qid") or get_next_qid()
    session_id = data.get("session_id") or data.get("sessionId") or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO qa_entries
           (id, qid, session_id, repo, question, answer, mode, domain,
            status, sources, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            eid, qid,
            session_id,
            data.get("repo", ""),
            data.get("question", ""),
            data.get("answer"),
            data.get("mode", "deep"),
            data.get("domain", "general"),
            "pending",
            json.dumps(data.get("sources", [])),
            json.dumps(data.get("tags", [])),
            now, now,
        ),
    )
    db.commit()
    return {"id": eid, "qid": qid, "session_id": session_id}


def _parse_json(val: str | None, default: list = None) -> list:
    if not val:
        return default or []
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default or []


def get_entry(qid: int) -> dict | None:
    db = get_qa_db()
    row = db.execute("SELECT * FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not row:
        return None
    entry = dict(row)
    entry["tags"] = _parse_json(entry.get("tags"))
    entry["sources"] = _parse_json(entry.get("sources"))
    entry["related_qids"] = _parse_json(entry.get("related_qids"))
    # Check calibrated
    cal = db.execute(
        "SELECT * FROM calibrated_answers WHERE qa_entry_id = ? ORDER BY version DESC LIMIT 1",
        (entry["id"],),
    ).fetchone()
    entry["is_calibrated"] = cal is not None
    entry["calibrated_answer"] = dict(cal) if cal else None
    return entry


def list_entries(query: dict) -> dict:
    db = get_qa_db()
    conditions = []
    params: list[Any] = []

    if query.get("repo"):
        conditions.append("repo = ?")
        params.append(query["repo"])
    if query.get("status"):
        conditions.append("status = ?")
        params.append(query["status"])
    if query.get("calibrated"):
        conditions.append("id IN (SELECT qa_entry_id FROM calibrated_answers)")
    if query.get("domain"):
        conditions.append("domain = ?")
        params.append(query["domain"])

    # Only root entries per session: first message in each session
    conditions.append(
        "(session_id = '' OR qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = qa_entries.session_id))"
    )
    where = " AND ".join(conditions) if conditions else "1=1"
    sort_map = {"latest": "created_at DESC", "popular": "visit_count DESC", "visit": "visit_count DESC"}
    order = sort_map.get(query.get("sort", ""), "created_at DESC")
    limit = min(query.get("limit", 20), 100)
    page = max(query.get("page", 1), 1)
    offset = (page - 1) * limit

    rows = db.execute(
        f"SELECT * FROM qa_entries WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    total = db.execute(
        f"SELECT COUNT(*) AS cnt FROM qa_entries WHERE {where}", params
    ).fetchone()["cnt"]

    entries = []
    for row in rows:
        e = dict(row)
        e["tags"] = _parse_json(e.get("tags"))
        e["sources"] = _parse_json(e.get("sources"))
        e["related_qids"] = _parse_json(e.get("related_qids"))
        cal = db.execute(
            "SELECT COUNT(*) AS c FROM calibrated_answers WHERE qa_entry_id = ?",
            (e["id"],),
        ).fetchone()
        e["is_calibrated"] = cal["c"] > 0
        entries.append(e)

    return {"entries": entries, "total": total, "page": page, "limit": limit}


def list_pending(repo: str | None = None) -> list[dict]:
    db = get_qa_db()
    if repo:
        rows = db.execute(
            "SELECT qid, question, created_at FROM qa_entries WHERE status = 'pending' AND repo = ? ORDER BY created_at DESC",
            (repo,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT qid, question, repo, created_at FROM qa_entries WHERE status = 'pending' ORDER BY created_at DESC",
        ).fetchall()
    return [dict(r) for r in rows]


def calibrate(qid: int, answer: str, calibrator: str = "admin") -> bool:
    db = get_qa_db()
    entry = db.execute("SELECT id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return False
    cal_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO calibrated_answers (id, qa_entry_id, answer, calibrator, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)""",
        (cal_id, entry["id"], answer, calibrator, now, now),
    )
    db.execute(
        "UPDATE qa_entries SET status = 'active', answer = ?, answered_at = ?, updated_at = ? WHERE id = ?",
        (answer, now, now, entry["id"]),
    )
    db.commit()
    return True


def search_questions(q: str, limit: int = 5) -> list[dict]:
    db = get_qa_db()
    rows = db.execute(
        "SELECT qid, question FROM qa_entries WHERE question LIKE ? ORDER BY visit_count DESC LIMIT ?",
        (f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]


def bump_visit(qid: int):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET visit_count = visit_count + 1 WHERE qid = ?", (qid,))
    db.commit()


def update_domain(qid: int, domain: str):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET domain = ? WHERE qid = ?", (domain, qid))
    db.commit()


def list_followups(qid: int) -> list[dict]:
    """返回同一 session 中除根消息外的所有追问，按时间正序。"""
    db = get_qa_db()
    entry = db.execute("SELECT session_id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return []
    session_id = entry["session_id"]
    if session_id:
        rows = db.execute(
            "SELECT qid, question, answer, created_at FROM qa_entries "
            "WHERE session_id = ? AND qid != ? "
            "ORDER BY created_at ASC",
            (session_id, qid),
        ).fetchall()
    else:
        # Legacy: entries with empty session_id, fallback to parent_qid
        rows = db.execute(
            "SELECT qid, question, answer, created_at FROM qa_entries "
            "WHERE parent_qid = ? "
            "ORDER BY created_at ASC",
            (qid,),
        ).fetchall()
    return [dict(r) for r in rows]
