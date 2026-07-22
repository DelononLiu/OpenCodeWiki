import uuid
from backend.database import get_knora_db

def create_kb(name: str, description: str = "") -> dict:
    db = get_knora_db()
    kb_id = f"kb-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_bases (id, name, description) VALUES (?, ?, ?)",
        (kb_id, name, description)
    )
    db.commit()
    return {"id": kb_id, "name": name, "description": description}

def list_kbs() -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, name, description, embedding_model, chunk_config, created_at FROM knowledge_bases ORDER BY created_at DESC"
    ).fetchall()
    return [_row_to_dict(r) for r in rows]

def get_kb(kb_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, name, description, embedding_model, chunk_config, created_at FROM knowledge_bases WHERE id = ?",
        (kb_id,)
    ).fetchone()
    return _row_to_dict(row) if row else None

def delete_kb(kb_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE kb_id = ?)", (kb_id,))
    db.execute("DELETE FROM sessions WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM chunks WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM documents WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM knowledge_bases WHERE id = ?", (kb_id,))
    db.commit()

def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "name": row[1], "description": row[2],
        "embedding_model": row[3], "chunk_config": row[4], "created_at": row[5]
    }
