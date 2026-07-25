import os
import re
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
    doc_count     INTEGER DEFAULT 0,
    chunk_count   INTEGER DEFAULT 0,
    repo_url      TEXT DEFAULT '',
    repo_type     TEXT DEFAULT '',
    repo_branch   TEXT DEFAULT '',
    content_type  TEXT DEFAULT 'docs',
    repo_version  TEXT DEFAULT '',
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
    kb_id         TEXT NOT NULL DEFAULT '',
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
    thinking      TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT DEFAULT 'pending',
    progress      INTEGER DEFAULT 0,
    progress_msg  TEXT DEFAULT '',
    kb_id         TEXT,
    repo_id       TEXT,
    params        TEXT DEFAULT '{}',
    error_message TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    started_at    TEXT,
    completed_at  TEXT
);

"""

# Add columns for existing databases (safe to run multiple times)
_MIGRATIONS = [
    "ALTER TABLE messages ADD COLUMN thinking TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN doc_count INTEGER DEFAULT 0",
    "ALTER TABLE knowledge_bases ADD COLUMN chunk_count INTEGER DEFAULT 0",
    "ALTER TABLE knowledge_bases ADD COLUMN repo_url TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN repo_type TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN repo_branch TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN content_type TEXT DEFAULT 'docs'",
    "ALTER TABLE knowledge_bases ADD COLUMN repo_version TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN svn_username TEXT DEFAULT ''",
    "ALTER TABLE knowledge_bases ADD COLUMN svn_password TEXT DEFAULT ''",
]

# ── Triggers: auto-maintain KB doc_count / chunk_count ──
_COUNT_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS trg_kb_doc_count_insert
AFTER INSERT ON documents BEGIN
    UPDATE knowledge_bases SET doc_count = doc_count + 1 WHERE id = NEW.kb_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_doc_count_delete
AFTER DELETE ON documents BEGIN
    UPDATE knowledge_bases SET doc_count = doc_count - 1 WHERE id = OLD.kb_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_chunk_count_insert
AFTER INSERT ON chunks BEGIN
    UPDATE knowledge_bases SET chunk_count = chunk_count + 1 WHERE id = NEW.kb_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_chunk_count_delete
AFTER DELETE ON chunks BEGIN
    UPDATE knowledge_bases SET chunk_count = chunk_count - 1 WHERE id = OLD.kb_id;
END;
"""

def _ensure_vectors_schema(conn: sqlite3.Connection, dimensions: int) -> None:
    """Create or migrate vector tables to match configured dimensions."""
    # FTS5 table is independent of dimensions — always ensure it exists
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
            chunk_id UNINDEXED,
            text,
            keywords
        )
    """)

    # Check if vec0 table already exists with the right dimensions
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='vector_chunks'"
    ).fetchone()

    if row:
        m = re.search(r'FLOAT\[(\d+)\]', row[0])
        current_dim = int(m.group(1)) if m else 0
        if current_dim != dimensions:
            print(f"[db] Vector dimension changed: {current_dim} -> {dimensions}, recreating table…")
            conn.execute("DROP TABLE IF EXISTS vector_chunks")
            conn.execute(f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS vector_chunks USING vec0(
                    vector FLOAT[{dimensions}],
                    chunk_id TEXT
                )
            """)
    else:
        conn.execute(f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS vector_chunks USING vec0(
                vector FLOAT[{dimensions}],
                chunk_id TEXT
            )
        """)
    conn.commit()


def _db_path(cfg: Config, db_name: str) -> str:
    data_dir = os.path.expanduser(cfg.database.path)
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, db_name)


def init_databases(cfg: Config) -> None:
    global _knora_conn, _vectors_conn

    knora_path = _db_path(cfg, "knora.db")
    _knora_conn = sqlite3.connect(knora_path)
    _knora_conn.execute("PRAGMA journal_mode=WAL")
    _knora_conn.execute("PRAGMA foreign_keys=ON")
    _knora_conn.executescript(KNORA_SCHEMA)

    # Migration: recreate sessions table without FK constraint (safe to re-run)
    _knora_conn.execute("PRAGMA foreign_keys=OFF")
    try:
        _knora_conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions_v2 (
                id            TEXT PRIMARY KEY,
                kb_id         TEXT NOT NULL DEFAULT '',
                title         TEXT DEFAULT '',
                created_at    TEXT DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO sessions_v2 SELECT * FROM sessions;
            DROP TABLE IF EXISTS sessions;
            ALTER TABLE sessions_v2 RENAME TO sessions;
        """)
    except Exception:
        pass
    _knora_conn.execute("PRAGMA foreign_keys=ON")

    # Run column migrations (safe to re-run)
    for migration in _MIGRATIONS:
        try:
            _knora_conn.execute(migration)
        except Exception:
            pass  # column already exists
    _knora_conn.commit()

    # Create count triggers
    _knora_conn.executescript(_COUNT_TRIGGERS)
    _knora_conn.commit()

    # Backfill cached counts for existing data (idempotent)
    _knora_conn.execute("""
        UPDATE knowledge_bases SET
            doc_count = (SELECT COUNT(*) FROM documents WHERE documents.kb_id = knowledge_bases.id),
            chunk_count = (SELECT COUNT(*) FROM chunks WHERE chunks.kb_id = knowledge_bases.id)
    """)
    _knora_conn.commit()

    vectors_path = _db_path(cfg, "vectors.db")
    _vectors_conn = sqlite3.connect(vectors_path)
    _vectors_conn.enable_load_extension(True)
    sqlite_vec.load(_vectors_conn)
    _vectors_conn.enable_load_extension(False)
    _vectors_conn.execute("PRAGMA journal_mode=WAL")
    _ensure_vectors_schema(_vectors_conn, cfg.embedding.dimensions)


def get_knora_db() -> sqlite3.Connection:
    assert _knora_conn is not None, "Database not initialized. Call init_databases first."
    return _knora_conn


def get_vectors_db() -> sqlite3.Connection:
    assert _vectors_conn is not None, "Database not initialized. Call init_databases first."
    return _vectors_conn
