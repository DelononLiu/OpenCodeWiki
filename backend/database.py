import os
import sqlite3
import sqlite_vec
from backend.config import Config

_knora_conn: sqlite3.Connection | None = None
_vectors_conn: sqlite3.Connection | None = None

KNORA_SCHEMA = """
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT DEFAULT '',
    embedding_model TEXT DEFAULT 'text-embedding-3-small',
    chunk_config  TEXT DEFAULT '{"size":512,"overlap":50}',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    file_hash     TEXT NOT NULL,
    file_type     TEXT NOT NULL,
    status        TEXT DEFAULT 'processing',
    chunks_count  INTEGER DEFAULT 0,
    error_message TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
    id            TEXT PRIMARY KEY,
    doc_id        TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    chunk_index   INTEGER NOT NULL,
    metadata      TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    sources       TEXT DEFAULT '[]',
    token_count   INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);
"""

VECTORS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS vector_chunks USING vec0(
    vector FLOAT[1536],
    chunk_id TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    chunk_id UNINDEXED,
    text,
    keywords
);
"""


def _db_path(cfg: Config, db_name: str) -> str:
    os.makedirs(cfg.database.path, exist_ok=True)
    return os.path.join(cfg.database.path, db_name)


def init_databases(cfg: Config) -> None:
    global _knora_conn, _vectors_conn

    knora_path = _db_path(cfg, "knora.db")
    _knora_conn = sqlite3.connect(knora_path)
    _knora_conn.execute("PRAGMA journal_mode=WAL")
    _knora_conn.execute("PRAGMA foreign_keys=ON")
    _knora_conn.executescript(KNORA_SCHEMA)
    _knora_conn.commit()

    vectors_path = _db_path(cfg, "vectors.db")
    _vectors_conn = sqlite3.connect(vectors_path)
    _vectors_conn.enable_load_extension(True)
    sqlite_vec.load(_vectors_conn)
    _vectors_conn.enable_load_extension(False)
    _vectors_conn.execute("PRAGMA journal_mode=WAL")
    _vectors_conn.executescript(VECTORS_SCHEMA)
    _vectors_conn.commit()


def get_knora_db() -> sqlite3.Connection:
    assert _knora_conn is not None, "Database not initialized. Call init_databases first."
    return _knora_conn


def get_vectors_db() -> sqlite3.Connection:
    assert _vectors_conn is not None, "Database not initialized. Call init_databases first."
    return _vectors_conn
