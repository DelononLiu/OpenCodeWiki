import uuid
from backend.database import get_knora_db

def create_session(kb_id: str, title: str = "") -> dict:
    db = get_knora_db()
    sid = f"ses-{uuid.uuid4().hex[:8]}"
    db.execute("INSERT INTO sessions (id, kb_id, title) VALUES (?, ?, ?)", (sid, kb_id, title))
    db.commit()
    return {"id": sid, "kb_id": kb_id, "title": title}

def get_session(sid: str) -> dict | None:
    db = get_knora_db()
    row = db.execute("SELECT id, kb_id, title, created_at FROM sessions WHERE id = ?", (sid,)).fetchone()
    if not row:
        return None
    return {"id": row[0], "kb_id": row[1], "title": row[2], "created_at": row[3]}

def list_sessions(kb_id: str | None = None) -> list[dict]:
    db = get_knora_db()
    if kb_id:
        rows = db.execute("SELECT id, kb_id, title, created_at FROM sessions WHERE kb_id = ? ORDER BY created_at DESC", (kb_id,)).fetchall()
    else:
        rows = db.execute("SELECT id, kb_id, title, created_at FROM sessions ORDER BY created_at DESC").fetchall()
    return [{"id": r[0], "kb_id": r[1], "title": r[2], "created_at": r[3]} for r in rows]

def delete_session(sid: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM messages WHERE session_id = ?", (sid,))
    db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
    db.commit()

def create_message(session_id: str, role: str, content: str, sources: str = "[]", token_count: int = 0) -> dict:
    db = get_knora_db()
    mid = f"msg-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO messages (id, session_id, role, content, sources, token_count) VALUES (?, ?, ?, ?, ?, ?)",
        (mid, session_id, role, content, sources, token_count)
    )
    db.commit()
    return {"id": mid, "session_id": session_id, "role": role, "content": content, "sources": sources, "token_count": token_count}

def get_messages(session_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, session_id, role, content, sources, token_count, created_at FROM messages WHERE session_id = ? ORDER BY created_at",
        (session_id,)
    ).fetchall()
    return [{"id": r[0], "session_id": r[1], "role": r[2], "content": r[3], "sources": r[4], "token_count": r[5], "created_at": r[6]} for r in rows]
