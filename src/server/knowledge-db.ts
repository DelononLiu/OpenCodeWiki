import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.opencodewiki', 'knowledge.db');

let _db: DatabaseSync | null = null;

export function getKnowledgeDb(): DatabaseSync {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec('PRAGMA foreign_keys=ON');
  initKnowledgeDb();
  return _db;
}

export function closeKnowledgeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function initKnowledgeDb(): void {
  const db = getKnowledgeDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT DEFAULT '',
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','reviewed','published')),
      project TEXT DEFAULT '',
      page_type TEXT DEFAULT 'entity',
      content TEXT DEFAULT '',
      search_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entity_files (
      entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      path TEXT NOT NULL,
      symbols TEXT DEFAULT '[]',
      PRIMARY KEY (entity_slug, path)
    );

    CREATE TABLE IF NOT EXISTS entity_relations (
      source_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      target_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      relation_type TEXT CHECK(relation_type IN ('depends-on','part-of','related')),
      weight REAL DEFAULT 1.0,
      source TEXT DEFAULT 'llm',
      PRIMARY KEY (source_slug, target_slug, relation_type)
    );

    CREATE TABLE IF NOT EXISTS entity_qa (
      entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      qid INTEGER
    );

    -- Unique index to support INSERT OR IGNORE dedup
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_qa ON entity_qa(entity_slug, qid);

    CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
      name, definition, content='entities', content_rowid='rowid'
    );
  `);
}
