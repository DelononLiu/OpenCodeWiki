"""Vector store wrapping sqlite-vec (vector search) + FTS5 (keyword search).

Provides insert, vector search, keyword search, and delete operations against
the vec0 virtual table and FTS5 index stored in vectors.db.
"""

import json
import struct
from backend.database import get_vectors_db, get_knora_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _vector_to_blob(vector: list[float]) -> bytes:
    """Pack a list of floats into a binary blob for sqlite-vec."""
    return struct.pack(f"{len(vector)}f", *vector)


def _blob_to_vector(blob: bytes) -> list[float]:
    """Unpack a binary blob back into a list of floats."""
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


# ---------------------------------------------------------------------------
# Insert
# ---------------------------------------------------------------------------

def insert_vectors(records: list[dict]) -> None:
    """Insert records into both the vec0 table and the FTS5 index.

    Each record should have:
        - chunk_id (str)
        - vector   (list[float])
        - text     (str)   — content to index in FTS5
        - keywords (str)   — auxiliary keywords for FTS5
    """
    vec_db = get_vectors_db()
    for rec in records:
        blob = _vector_to_blob(rec["vector"])
        vec_db.execute(
            "INSERT INTO vector_chunks (vector, chunk_id) VALUES (?, ?)",
            (blob, rec["chunk_id"]),
        )
        vec_db.execute(
            "INSERT INTO chunk_fts (chunk_id, text, keywords) VALUES (?, ?, ?)",
            (rec["chunk_id"], rec.get("text", ""), rec.get("keywords", "")),
        )
    vec_db.commit()


# ---------------------------------------------------------------------------
# Vector search
# ---------------------------------------------------------------------------

def search_vector(
    query_vector: list[float],
    kb_id: str,
    top_k: int = 20,
) -> list[dict]:
    """ANN search via sqlite-vec, filtered by *kb_id* via knora join.

    Returns up to *top_k* results, each containing:
        chunk_id, content, doc_id, score, source
    """
    vec_db = get_vectors_db()
    knora_db = get_knora_db()
    blob = _vector_to_blob(query_vector)

    # vec0 virtual table MATCH query — falls back to vec_distance_L2
    try:
        rows = vec_db.execute(
            "SELECT chunk_id, distance "
            "FROM vector_chunks WHERE vector MATCH ? "
            "ORDER BY distance LIMIT ?",
            (blob, top_k),
        ).fetchall()
    except Exception:
        rows = vec_db.execute(
            "SELECT chunk_id, vec_distance_L2(vector, ?) AS dist "
            "FROM vector_chunks ORDER BY dist LIMIT ?",
            (blob, top_k),
        ).fetchall()

    results: list[dict] = []
    for row in rows:
        chunk_id = row[0]
        distance = float(row[1]) if row[1] is not None else 0.0
        score = 1.0 - distance  # convert distance to similarity

        chunk = knora_db.execute(
            """SELECT c.id, c.content, c.doc_id, c.kb_id, d.title
               FROM chunks c
               JOIN documents d ON c.doc_id = d.id
               WHERE c.id = ? AND c.kb_id = ?""",
            (chunk_id, kb_id),
        ).fetchone()

        if chunk:
            results.append({
                "chunk_id": chunk[0],
                "content": chunk[1],
                "doc_id": chunk[2],
                "score": score,
                "source": "vector",
                "title": chunk[4],
            })

    return results


# ---------------------------------------------------------------------------
# Keyword search
# ---------------------------------------------------------------------------

def search_keyword(
    keywords: list[str],
    kb_id: str,
    top_k: int = 10,
) -> list[dict]:
    """FTS5 keyword search, filtered by *kb_id* via knora join.

    Joins keywords with OR.  Returns chunk metadata and BM25 rank as *score*.
    """
    vec_db = get_vectors_db()
    knora_db = get_knora_db()
    query = " OR ".join(keywords)

    try:
        rows = vec_db.execute(
            "SELECT chunk_id, rank "
            "FROM chunk_fts WHERE chunk_fts MATCH ? "
            "ORDER BY rank LIMIT ?",
            (query, top_k),
        ).fetchall()
    except Exception:
        return []

    results: list[dict] = []
    for row in rows:
        chunk_id = row[0]

        chunk = knora_db.execute(
            """SELECT c.id, c.content, c.doc_id, c.kb_id, d.title
               FROM chunks c
               JOIN documents d ON c.doc_id = d.id
               WHERE c.id = ? AND c.kb_id = ?""",
            (chunk_id, kb_id),
        ).fetchone()

        if chunk:
            results.append({
                "chunk_id": chunk[0],
                "content": chunk[1],
                "doc_id": chunk[2],
                "score": float(row[1]) if row[1] else 0.0,
                "source": "keyword",
                "title": chunk[4],
            })

    return results


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def delete_by_doc_id(doc_id: str) -> None:
    """Remove all vector- and FTS5-entries for every chunk belonging to *doc_id*."""
    knora_db = get_knora_db()
    vec_db = get_vectors_db()

    chunk_ids = [
        r[0]
        for r in knora_db.execute(
            "SELECT id FROM chunks WHERE doc_id = ?", (doc_id,)
        ).fetchall()
    ]

    for cid in chunk_ids:
        vec_db.execute("DELETE FROM vector_chunks WHERE chunk_id = ?", (cid,))
        vec_db.execute("DELETE FROM chunk_fts WHERE chunk_id = ?", (cid,))
    vec_db.commit()


def delete_by_kb_id(kb_id: str) -> None:
    """Remove all vector- and FTS5-entries for every chunk in *kb_id*."""
    knora_db = get_knora_db()
    vec_db = get_vectors_db()

    chunk_ids = [
        r[0]
        for r in knora_db.execute(
            "SELECT id FROM chunks WHERE kb_id = ?", (kb_id,)
        ).fetchall()
    ]

    for cid in chunk_ids:
        vec_db.execute("DELETE FROM vector_chunks WHERE chunk_id = ?", (cid,))
        vec_db.execute("DELETE FROM chunk_fts WHERE chunk_id = ?", (cid,))
    vec_db.commit()
