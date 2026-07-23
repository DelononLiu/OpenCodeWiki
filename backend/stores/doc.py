import uuid
from backend.database import get_knora_db

def create_document(kb_id: str, title: str, file_path: str, file_hash: str, file_type: str) -> dict:
    db = get_knora_db()
    doc_id = f"doc-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO documents (id, kb_id, title, file_path, file_hash, file_type) VALUES (?, ?, ?, ?, ?, ?)",
        (doc_id, kb_id, title, file_path, file_hash, file_type)
    )
    db.commit()
    return {"id": doc_id, "kb_id": kb_id, "title": title, "file_path": file_path, "file_type": file_type, "status": "processing"}

def get_document(doc_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, kb_id, title, file_path, file_hash, file_type, status, chunks_count, error_message, created_at FROM documents WHERE id = ?",
        (doc_id,)
    ).fetchone()
    if not row:
        return None
    return {"id": row[0], "kb_id": row[1], "title": row[2], "file_path": row[3], "file_hash": row[4],
            "file_type": row[5], "status": row[6], "chunks_count": row[7], "error_message": row[8], "created_at": row[9]}

def list_documents(kb_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, kb_id, title, file_path, file_hash, file_type, status, chunks_count, error_message, created_at FROM documents WHERE kb_id = ? ORDER BY created_at DESC",
        (kb_id,)
    ).fetchall()
    return [{"id": r[0], "kb_id": r[1], "title": r[2], "file_path": r[3], "file_hash": r[4],
             "file_type": r[5], "status": r[6], "chunks_count": r[7], "error_message": r[8], "created_at": r[9]} for r in rows]

def update_document_status(doc_id: str, status: str, error_message: str | None = None) -> None:
    db = get_knora_db()
    if error_message:
        db.execute("UPDATE documents SET status = ?, error_message = ? WHERE id = ?", (status, error_message, doc_id))
    else:
        db.execute("UPDATE documents SET status = ? WHERE id = ?", (status, doc_id))
    db.commit()

def update_document_chunks_count(doc_id: str, count: int) -> None:
    db = get_knora_db()
    db.execute("UPDATE documents SET chunks_count = ?, status = 'completed' WHERE id = ?", (count, doc_id))
    db.commit()

def delete_document(doc_id: str) -> None:
    db = get_knora_db()
    delete_chunks_by_doc(doc_id)
    db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    db.commit()

def create_chunk(doc_id: str, kb_id: str, content: str, chunk_index: int, metadata: str = "{}") -> dict:
    db = get_knora_db()
    chunk_id = f"chk-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO chunks (id, doc_id, kb_id, content, chunk_index, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        (chunk_id, doc_id, kb_id, content, chunk_index, metadata)
    )
    db.commit()
    return {"id": chunk_id, "doc_id": doc_id, "kb_id": kb_id, "content": content, "chunk_index": chunk_index}

def create_chunks_batch(doc_id: str, kb_id: str, chunks: list[tuple[str, int, str]]) -> list[dict]:
    """Bulk insert chunks. chunks = [(content, chunk_index, metadata), ...]"""
    if not chunks:
        return []
    db = get_knora_db()
    ids = [f"chk-{uuid.uuid4().hex[:8]}" for _ in chunks]
    rows = [(ids[i], doc_id, kb_id, chunks[i][0], chunks[i][1], chunks[i][2]) for i in range(len(chunks))]
    db.executemany(
        "INSERT INTO chunks (id, doc_id, kb_id, content, chunk_index, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    db.commit()
    return [{"id": ids[i], "doc_id": doc_id, "kb_id": kb_id,
             "content": chunks[i][0], "chunk_index": chunks[i][1]} for i in range(len(chunks))]

def delete_chunks_by_doc(doc_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    db.commit()

def delete_chunks_by_kb(kb_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM chunks WHERE kb_id = ?", (kb_id,))
    db.commit()

def get_chunks_by_doc(doc_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, doc_id, kb_id, content, chunk_index, metadata FROM chunks WHERE doc_id = ? ORDER BY chunk_index",
        (doc_id,)
    ).fetchall()
    return [{"id": r[0], "doc_id": r[1], "kb_id": r[2], "content": r[3], "chunk_index": r[4], "metadata": r[5]} for r in rows]

def get_chunks_by_kb(kb_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        "SELECT id, doc_id, kb_id, content, chunk_index, metadata FROM chunks WHERE kb_id = ? ORDER BY chunk_index",
        (kb_id,)
    ).fetchall()
    return [{"id": r[0], "doc_id": r[1], "kb_id": r[2], "content": r[3], "chunk_index": r[4], "metadata": r[5]} for r in rows]
