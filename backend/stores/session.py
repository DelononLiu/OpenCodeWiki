import uuid
from backend.database import get_knora_db

def create_session(kb_id: str, title: str = "", owner_id: str = "") -> dict:
    db = get_knora_db()
    sid = f"ses-{uuid.uuid4().hex[:8]}"
    db.execute("INSERT INTO sessions (id, kb_id, title, owner_id) VALUES (?, ?, ?, ?)",
               (sid, kb_id, title, owner_id))
    db.commit()
    return {"id": sid, "kb_id": kb_id, "title": title, "owner_id": owner_id}


def get_session(sid: str) -> dict | None:
    db = get_knora_db()
    row = db.execute("SELECT id, kb_id, title, owner_id, created_at FROM sessions WHERE id = ?", (sid,)).fetchone()
    if not row:
        return None
    return {"id": row[0], "kb_id": row[1], "title": row[2], "owner_id": row[3], "created_at": row[4]}


def list_sessions(kb_id: str | None = None, owner_id: str | None = None) -> list[dict]:
    db = get_knora_db()
    sql = "SELECT id, kb_id, title, owner_id, created_at FROM sessions"
    conds, params = [], []
    if kb_id:
        conds.append("kb_id = ?")
        params.append(kb_id)
    if owner_id is not None:
        # 个人：自己的 + 无主遗留（owner_id=''）；admin 传 None 看全部
        conds.append("(owner_id = ? OR owner_id = '')")
        params.append(owner_id)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY created_at DESC"
    rows = db.execute(sql, params).fetchall()
    return [{"id": r[0], "kb_id": r[1], "title": r[2], "owner_id": r[3], "created_at": r[4]} for r in rows]

def delete_session(sid: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM messages WHERE session_id = ?", (sid,))
    db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
    db.commit()

def create_message(session_id: str, role: str, content: str, sources: str = "[]", token_count: int = 0, thinking: str = "") -> dict:
    db = get_knora_db()
    mid = f"msg-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO messages (id, session_id, role, content, sources, token_count, thinking) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (mid, session_id, role, content, sources, token_count, thinking)
    )
    db.commit()
    return {"id": mid, "session_id": session_id, "role": role, "content": content, "sources": sources, "token_count": token_count, "thinking": thinking}

def get_messages(session_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, session_id, role, content, sources, token_count, thinking, created_at FROM messages WHERE session_id = ? ORDER BY created_at",
        (session_id,)
    ).fetchall()
    return [{"id": r[0], "session_id": r[1], "role": r[2], "content": r[3], "sources": r[4], "token_count": r[5], "thinking": r[6] or "", "created_at": r[7]} for r in rows]
