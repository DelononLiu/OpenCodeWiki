import uuid
from backend.database import get_knora_db

DEFAULT_KB_NAME = "默认知识库"

def create_kb(name: str, description: str = "", embedding_model: str = "") -> dict:
    db = get_knora_db()
    kb_id = f"kb-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_bases (id, name, description, embedding_model) VALUES (?, ?, ?, ?)",
        (kb_id, name, description, embedding_model or "text-embedding-3-small")
    )
    db.commit()
    return {"id": kb_id, "name": name, "description": description, "embedding_model": embedding_model}

def list_kbs() -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        """SELECT id, name, description, embedding_model, chunk_config,
                  doc_count, chunk_count, created_at
           FROM knowledge_bases
           ORDER BY (name = ?) DESC, created_at DESC""",
        (DEFAULT_KB_NAME,)
    ).fetchall()
    return [_row_to_dict(r) for r in rows]

def get_kb(kb_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, name, description, embedding_model, chunk_config, doc_count, chunk_count, created_at FROM knowledge_bases WHERE id = ?",
        (kb_id,)
    ).fetchone()
    return _row_to_dict(row) if row else None

def get_kb_by_name(name: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, name, description, embedding_model, chunk_config, doc_count, chunk_count, created_at FROM knowledge_bases WHERE name = ?",
        (name,)
    ).fetchone()
    return _row_to_dict(row) if row else None

def delete_kb(kb_id: str) -> None:
    db = get_knora_db()
    kb = get_kb(kb_id)
    if kb and kb["name"] == DEFAULT_KB_NAME:
        raise ValueError("Cannot delete default knowledge base")
    db.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE kb_id = ?)", (kb_id,))
    db.execute("DELETE FROM sessions WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM chunks WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM documents WHERE kb_id = ?", (kb_id,))
    db.execute("DELETE FROM knowledge_bases WHERE id = ?", (kb_id,))
    db.commit()

def ensure_default_kb(embedding_model: str = "") -> dict:
    """Get or create the default knowledge base."""
    existing = get_kb_by_name(DEFAULT_KB_NAME)
    if existing:
        return existing
    return create_kb(DEFAULT_KB_NAME, "系统默认知识库，存放自述文档和 Wiki 沉淀", embedding_model)

def _row_to_dict(row) -> dict:
    d = {
        "id": row[0], "name": row[1], "description": row[2],
        "embedding_model": row[3], "chunk_config": row[4], "created_at": row[5]
    }
    # Optional aggregation fields
    if len(row) >= 8:
        d["doc_count"] = row[6] or 0
        d["chunk_count"] = row[7] or 0
    d["is_default"] = d["name"] == DEFAULT_KB_NAME
    return d
