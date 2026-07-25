import uuid
from backend.database import get_knora_db

DEFAULT_KB_NAME = "默认知识库"

def create_kb(name: str, description: str = "", embedding_model: str = "",
              repo_url: str = "", repo_type: str = "", repo_branch: str = "",
              content_type: str = "docs",
              svn_username: str = "", svn_password: str = "") -> dict:
    db = get_knora_db()
    # 检查名称
    if not name or not name.strip():
        raise ValueError("知识库名称不能为空")
    # 检查名称是否重复
    existing = db.execute("SELECT id FROM knowledge_bases WHERE name = ?", (name,)).fetchone()
    if existing:
        raise ValueError(f"知识库名称 '{name}' 已存在")
    kb_id = f"kb-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_bases (id, name, description, embedding_model, repo_url, repo_type, repo_branch, content_type, svn_username, svn_password) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (kb_id, name, description, embedding_model or "text-embedding-3-small",
         repo_url, repo_type, repo_branch, content_type,
         svn_username, svn_password),
    )
    db.commit()
    return {"id": kb_id, "name": name, "description": description, "embedding_model": embedding_model}

_KB_COLS = "id, name, description, embedding_model, chunk_config, doc_count, chunk_count, repo_url, repo_type, repo_branch, content_type, repo_version, svn_username, svn_password, created_at"

def list_kbs() -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        f"SELECT {_KB_COLS} FROM knowledge_bases ORDER BY (name = ?) DESC, created_at DESC",
        (DEFAULT_KB_NAME,)
    ).fetchall()
    return [_row_to_dict(r) for r in rows]

def get_kb(kb_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        f"SELECT {_KB_COLS} FROM knowledge_bases WHERE id = ?", (kb_id,)
    ).fetchone()
    return _row_to_dict(row) if row else None

def get_kb_with_credentials(kb_id: str) -> dict | None:
    """Same as get_kb but includes svn_username/svn_password for server-side use."""
    db = get_knora_db()
    row = db.execute(
        f"SELECT {_KB_COLS} FROM knowledge_bases WHERE id = ?", (kb_id,)
    ).fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    d["svn_username"] = row[12] or ""
    d["svn_password"] = row[13] or ""
    return d

def get_kb_by_name(name: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        f"SELECT {_KB_COLS} FROM knowledge_bases WHERE name = ?", (name,)
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
    # columns: id, name, desc, em, chunk_config, doc_count, chunk_count, repo_url, repo_type, repo_branch, content_type, repo_version, svn_username, svn_password, created_at
    d = {
        "id": row[0], "name": row[1], "description": row[2],
        "embedding_model": row[3], "chunk_config": row[4],
        "doc_count": row[5] or 0, "chunk_count": row[6] or 0,
        "repo_url": row[7] or "", "repo_type": row[8] or "",
        "repo_branch": row[9] or "", "content_type": row[10] or "docs",
        "repo_version": row[11] or "",
        # NOTE: svn_username/svn_password intentionally omitted — use get_kb_with_credentials()
        "created_at": row[14],
    }
    d["is_default"] = d["name"] == DEFAULT_KB_NAME
    return d


def update_kb_credentials(kb_id: str, username: str, password: str) -> None:
    """Update SVN credentials for a knowledge base."""
    db = get_knora_db()
    db.execute(
        "UPDATE knowledge_bases SET svn_username = ?, svn_password = ? WHERE id = ?",
        (username, password, kb_id),
    )
    db.commit()
