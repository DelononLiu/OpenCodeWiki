"""
database.py — Unified SQLite database initialization.

Migrates existing qa.db + knowledge.db from Node.js era into Python-managed
schemas. Uses sqlite3 (standard library).
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DB_DIR = Path.home() / ".opencodewiki"


def _db_path(name: str) -> str:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return str(DB_DIR / name)


# ── QA Database (qa.db) ─────────────────────────────────────────

_qa_db: sqlite3.Connection | None = None


def get_qa_db() -> sqlite3.Connection:
    global _qa_db
    if _qa_db is not None:
        return _qa_db
    _qa_db = sqlite3.connect(_db_path("qa.db"))
    _qa_db.row_factory = sqlite3.Row
    _qa_db.execute("PRAGMA journal_mode=WAL")
    _qa_db.execute("PRAGMA foreign_keys=ON")
    _init_qa_db(_qa_db)
    return _qa_db


def _init_qa_db(db: sqlite3.Connection):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS qa_entries (
            id            TEXT PRIMARY KEY,
            qid           INTEGER UNIQUE NOT NULL,
            session_id    TEXT,
            repo          TEXT NOT NULL DEFAULT '',
            module        TEXT,
            question      TEXT NOT NULL,
            answer        TEXT,
            mode          TEXT NOT NULL DEFAULT 'deep'
                          CHECK(mode IN ('lightweight','deep')),
            domain        TEXT NOT NULL DEFAULT 'general',
            status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('active','pending','archived')),
            parent_qid    INTEGER,
            related_qids  TEXT DEFAULT '[]',
            tags          TEXT DEFAULT '[]',
            sources       TEXT DEFAULT '[]',
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now')),
            answered_at   TEXT,
            visit_count   INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_qa_repo ON qa_entries(repo);
        CREATE INDEX IF NOT EXISTS idx_qa_status ON qa_entries(status);
        CREATE INDEX IF NOT EXISTS idx_qa_qid ON qa_entries(qid);

        CREATE TABLE IF NOT EXISTS calibrated_answers (
            id          TEXT PRIMARY KEY,
            qa_entry_id TEXT NOT NULL REFERENCES qa_entries(id),
            answer      TEXT NOT NULL,
            calibrator  TEXT NOT NULL DEFAULT '',
            reason      TEXT,
            version     INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ca_entry
            ON calibrated_answers(qa_entry_id);

        CREATE TABLE IF NOT EXISTS session_topics (
            session_id  TEXT NOT NULL,
            topic_slug  TEXT NOT NULL,
            PRIMARY KEY (session_id, topic_slug)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_index USING fts5(
            slug,
            chunk_text,
            keywords,
            published_at,
            content='',
            content_rowid='rowid'
        );

        CREATE TABLE IF NOT EXISTS wiki_modules (
            slug       TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL DEFAULT 'source',
            title      TEXT,
            kb_name    TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS wiki_conversions (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            wiki_slug   TEXT NOT NULL,
            wiki_title  TEXT,
            module_slug TEXT,
            qa_count    INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now'))
        );
    """)

    # 新增列（migration-safe）
    for col, defn in [
        ("feedback", "TEXT DEFAULT NULL"),
        ("changes", "TEXT DEFAULT NULL"),
    ]:
        try:
            db.execute(f"ALTER TABLE qa_entries ADD COLUMN {col} {defn}")
        except Exception:
            pass  # column already exists


def close_qa_db():
    global _qa_db
    if _qa_db:
        _qa_db.close()
        _qa_db = None


# ── Knowledge Database (knowledge.db) ───────────────────────────

_knowledge_db: sqlite3.Connection | None = None


def get_knowledge_db() -> sqlite3.Connection:
    global _knowledge_db
    if _knowledge_db is not None:
        return _knowledge_db
    _knowledge_db = sqlite3.connect(_db_path("knowledge.db"))
    _knowledge_db.row_factory = sqlite3.Row
    _knowledge_db.execute("PRAGMA journal_mode=WAL")
    _knowledge_db.execute("PRAGMA foreign_keys=ON")
    _init_knowledge_db(_knowledge_db)
    return _knowledge_db


def _init_knowledge_db(db: sqlite3.Connection):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS entities (
            slug          TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            definition    TEXT DEFAULT '',
            status        TEXT DEFAULT 'draft'
                          CHECK(status IN ('draft','reviewed','published')),
            project       TEXT DEFAULT '',
            page_type     TEXT DEFAULT 'entity',
            content       TEXT DEFAULT '',
            search_count  INTEGER DEFAULT 0,
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS entity_files (
            entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
            path        TEXT NOT NULL,
            symbols     TEXT DEFAULT '[]',
            PRIMARY KEY (entity_slug, path)
        );
        CREATE TABLE IF NOT EXISTS entity_qa (
            entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
            qid         INTEGER,
            PRIMARY KEY (entity_slug, qid)
        );
        CREATE TABLE IF NOT EXISTS topics (
            slug        TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'pool'
                        CHECK(status IN ('pool', 'published')),
            wiki_module TEXT DEFAULT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            published_at TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS topic_qa (
            topic_slug  TEXT NOT NULL REFERENCES topics(slug),
            qid         INTEGER NOT NULL,
            PRIMARY KEY (topic_slug, qid)
        );
        CREATE TABLE IF NOT EXISTS topic_drafts (
            topic_slug    TEXT PRIMARY KEY REFERENCES topics(slug),
            raw_content   TEXT NOT NULL,
            edited_content TEXT DEFAULT NULL,
            status        TEXT DEFAULT 'pending'
                          CHECK(status IN ('pending','submitted','approved','rejected')),
            reviewer      TEXT DEFAULT '',
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now')),
            reviewed_at   TEXT DEFAULT NULL,
            reject_reason TEXT DEFAULT NULL,
            generated_at  TEXT DEFAULT NULL
        );
    """)

    # Migration: add columns to topic_drafts if missing
    for col, defn in [
        ("updated_at", "TEXT DEFAULT (datetime('now'))"),
        ("reject_reason", "TEXT DEFAULT NULL"),
        ("generated_at", "TEXT DEFAULT NULL"),
    ]:
        try:
            db.execute(f"ALTER TABLE topic_drafts ADD COLUMN {col} {defn}")
        except Exception:
            pass

    # Migration: fix CHECK constraint to include 'submitted' for existing databases
    try:
        # Check if 'submitted' is in the CHECK by examining table_info
        # We detect old constraint by trying a temp insert — if it fails, we migrate
        old_check = True
        try:
            db.execute("INSERT INTO topic_drafts (topic_slug, raw_content, status) VALUES ('__migration_test__', 'test', 'submitted')")
            db.execute("DELETE FROM topic_drafts WHERE topic_slug = '__migration_test__'")
            old_check = False
        except Exception:
            pass

        if old_check:
            # Recreate table with correct CHECK constraint
            db.executescript("""
                CREATE TABLE IF NOT EXISTS topic_drafts_new (
                    topic_slug    TEXT PRIMARY KEY REFERENCES topics(slug),
                    raw_content   TEXT NOT NULL,
                    edited_content TEXT DEFAULT NULL,
                    status        TEXT DEFAULT 'pending'
                                  CHECK(status IN ('pending','submitted','approved','rejected')),
                    reviewer      TEXT DEFAULT '',
                    created_at    TEXT DEFAULT (datetime('now')),
                    updated_at    TEXT DEFAULT (datetime('now')),
                    reviewed_at   TEXT DEFAULT NULL,
                    reject_reason TEXT DEFAULT NULL,
                    generated_at  TEXT DEFAULT NULL
                );
                INSERT INTO topic_drafts_new SELECT * FROM topic_drafts;
                DROP TABLE topic_drafts;
                ALTER TABLE topic_drafts_new RENAME TO topic_drafts;
            """)
    except Exception:
        pass


def close_knowledge_db():
    global _knowledge_db
    if _knowledge_db:
        _knowledge_db.close()
        _knowledge_db = None


# ── Unified init ────────────────────────────────────────────────

def init_databases():
    get_qa_db()
    get_knowledge_db()
