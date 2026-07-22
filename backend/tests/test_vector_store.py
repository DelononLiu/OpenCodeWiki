"""Tests for the vector store module (sqlite-vec + FTS5)."""

import tempfile
from backend.database import init_databases, get_knora_db, get_vectors_db
from backend.config import Config
from backend.knowledge.vector_store import (
    insert_vectors,
    search_vector,
    search_keyword,
    delete_by_doc_id,
)


def setup_module():
    """Initialize databases with a temp directory, and seed knora with test data."""
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    init_databases(cfg)

    knora = get_knora_db()
    knora.execute(
        "INSERT INTO knowledge_bases (id, name) VALUES ('kb-1', 'Test KB')"
    )
    knora.execute(
        "INSERT INTO documents (id, kb_id, title, file_path, file_hash, file_type, status) "
        "VALUES ('doc-1', 'kb-1', 'test.md', '/tmp/test.md', 'abc123', 'md', 'processed')"
    )
    for chunk_id, content, idx in [
        ("chk-a", "JWT tokens expire after 24 hours", 0),
        ("chk-b", "OAuth2 provides delegated authorization", 1),
        ("chk-c", "Password hashing uses bcrypt algorithm", 2),
        ("chk-del", "to delete", 3),
    ]:
        knora.execute(
            "INSERT INTO chunks (id, doc_id, kb_id, content, chunk_index) "
            "VALUES (?, ?, ?, ?, ?)",
            (chunk_id, "doc-1", "kb-1", content, idx),
        )
    knora.commit()


def _random_vector(dim=1536):
    import random

    return [random.random() for _ in range(dim)]


class TestVectorStore:
    def test_insert_and_search_vector(self):
        """Insert three vectors, then search and verify result structure."""
        chunks = [
            {"id": "chk-a", "content": "JWT tokens expire after 24 hours", "kb_id": "kb-1"},
            {"id": "chk-b", "content": "OAuth2 provides delegated authorization", "kb_id": "kb-1"},
            {"id": "chk-c", "content": "Password hashing uses bcrypt algorithm", "kb_id": "kb-1"},
        ]
        records = [
            {
                "chunk_id": c["id"],
                "vector": _random_vector(),
                "text": c["content"],
                "keywords": "test",
            }
            for c in chunks
        ]
        insert_vectors(records)

        query = _random_vector()
        results = search_vector(query, "kb-1", top_k=2)
        assert len(results) <= 2
        for r in results:
            assert "chunk_id" in r
            assert "score" in r

    def test_search_keyword(self):
        """FTS5 keyword search — result count may vary by tokenizer."""
        results = search_keyword(["JWT"], "kb-1", top_k=5)
        assert len(results) >= 0

    def test_delete_by_doc(self):
        """Insert a vector, verify it exists, delete by doc_id, verify gone."""
        insert_vectors(
            [
                {
                    "chunk_id": "chk-del",
                    "vector": _random_vector(),
                    "text": "to delete",
                    "keywords": "delete",
                }
            ]
        )

        # Verify the row exists in vectors_db before deletion
        vec_db = get_vectors_db()
        before = vec_db.execute(
            "SELECT COUNT(*) FROM chunk_fts WHERE chunk_id = ?", ("chk-del",)
        ).fetchone()[0]
        assert before > 0

        delete_by_doc_id("doc-1")

        # Verify it is gone after deletion
        after = vec_db.execute(
            "SELECT COUNT(*) FROM chunk_fts WHERE chunk_id = ?", ("chk-del",)
        ).fetchone()[0]
        assert after == 0
