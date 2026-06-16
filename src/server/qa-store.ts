/**
 * qa-store.ts — SQLite 持久化层 for #Q 问答沉淀体系
 *
 * 独立 SQLite 数据库 `~/.opencodewiki/qa.db`，与 codegraph 索引库分离。
 * 使用 Node 内置 node:sqlite (DatabaseSync), 无需安装 better-sqlite3。
 */

import { randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ── Types ──────────────────────────────────────────────────────

export interface QaEntry {
  id: string;
  qid: number;
  sessionId: string;
  repo: string;
  module: string | null;
  question: string;
  answer: string | null;
  mode: 'lightweight' | 'deep';
  status: 'active' | 'archived';
  parentQid: number | null;
  relatedQids: number[];
  tags: string[];
  sources: any[];
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  visitCount: number;
}

export interface CalibratedAnswer {
  id: string;
  qaEntryId: string;
  answer: string;
  calibrator: string;
  reason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QaEntrySummary {
  qid: number;
  question: string;
  mode: 'lightweight' | 'deep';
  status: 'active' | 'archived';
  repo: string;
  module: string | null;
  parentQid: number | null;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  visitCount: number;
  isCalibrated: boolean;
}

export interface QaEntryDetail extends QaEntry {
  isCalibrated: boolean;
  calibratedAnswer: CalibratedAnswer | null;
  children: QaEntrySummary[];
}

export interface QaListQuery {
  repo?: string;
  mode?: 'lightweight' | 'deep';
  status?: 'active' | 'archived';
  page?: number;
  limit?: number;
  sort?: 'latest' | 'popular' | 'visit';
}

// ── Database Connection ────────────────────────────────────────

const SQL_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS qa_entries (
    id            TEXT PRIMARY KEY,
    qid           INTEGER UNIQUE NOT NULL,
    session_id    TEXT NOT NULL,
    repo          TEXT NOT NULL DEFAULT '',
    module        TEXT,
    question      TEXT NOT NULL,
    answer        TEXT,
    mode          TEXT NOT NULL DEFAULT 'deep' CHECK(mode IN ('lightweight','deep')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    parent_qid    INTEGER,
    related_qids  TEXT,
    tags          TEXT,
    sources       TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    answered_at   TEXT,
    visit_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calibrated_answers (
    id            TEXT PRIMARY KEY,
    qa_entry_id   TEXT NOT NULL REFERENCES qa_entries(id),
    answer        TEXT NOT NULL,
    calibrator    TEXT NOT NULL DEFAULT '',
    reason        TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_qid ON qa_entries(qid);
CREATE INDEX IF NOT EXISTS idx_qa_repo ON qa_entries(repo);
CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_qa_parent ON qa_entries(parent_qid);
CREATE INDEX IF NOT EXISTS idx_qa_mode ON qa_entries(mode);
CREATE INDEX IF NOT EXISTS idx_qa_created ON qa_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_ca_entry ON calibrated_answers(qa_entry_id);
`;

function getDbPath(): string {
  const dir = process.env.OPENCODEWIKI_QA_DATA_DIR || path.join(os.homedir(), '.opencodewiki');
  return path.join(dir, 'qa.db');
}

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (_db) return _db;
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  _db = new DatabaseSync(dbPath);
  // Enable WAL mode for concurrent read performance
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec(SQL_CREATE_TABLES);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Helpers ────────────────────────────────────────────────────

function rowToQaEntry(row: any): QaEntry {
  return {
    id: row.id,
    qid: row.qid,
    sessionId: row.session_id,
    repo: row.repo,
    module: row.module,
    question: row.question,
    answer: row.answer,
    mode: row.mode,
    status: row.status,
    parentQid: row.parent_qid,
    relatedQids: parseJsonArray(row.related_qids),
    tags: parseJsonArray(row.tags),
    sources: parseJsonArray(row.sources),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: row.answered_at,
    visitCount: row.visit_count,
  };
}

function rowToSummary(row: any): QaEntrySummary {
  return {
    qid: row.qid,
    question: row.question,
    mode: row.mode,
    status: row.status,
    repo: row.repo,
    module: row.module,
    parentQid: row.parent_qid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: row.answered_at,
    visitCount: row.visit_count,
    isCalibrated: !!row.calibrated_count,
  };
}

function parseJsonArray(val: string | null | undefined): any[] {
  if (!val) return [];
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

function toJsonArray(arr: any[] | null | undefined): string {
  if (!arr || arr.length === 0) return '';
  return JSON.stringify(arr);
}

// ── #Q ID Generation ───────────────────────────────────────────

const QID_START = 10000;

/**
 * Get the next #Q auto-increment ID.
 * Thread-safe within a single process (serialized SQLite).
 */
export function nextQid(): number {
  const db = getDb();
  const row = db.prepare('SELECT COALESCE(MAX(qid), ?) + 1 AS next_qid FROM qa_entries').get(QID_START - 1);
  return (row as any).next_qid;
}

// ── CRUD ───────────────────────────────────────────────────────

export function createEntry(data: {
  sessionId: string;
  repo: string;
  module?: string | null;
  question: string;
  answer?: string | null;
  mode: 'lightweight' | 'deep';
  parentQid?: number | null;
  relatedQids?: number[];
  tags?: string[];
  sources?: any[];
}): QaEntry {
  const db = getDb();
  const id = randomUUID();
  const qid = nextQid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO qa_entries (id, qid, session_id, repo, module, question, answer, mode, parent_qid, related_qids, tags, sources, created_at, updated_at, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, qid, data.sessionId, data.repo,
    data.module ?? null, data.question,
    data.answer ?? null, data.mode,
    data.parentQid ?? null,
    toJsonArray(data.relatedQids),
    toJsonArray(data.tags),
    toJsonArray(data.sources),
    now, now,
    data.mode === 'deep' ? now : null
  );

  return {
    id, qid, sessionId: data.sessionId,
    repo: data.repo, module: data.module ?? null,
    question: data.question, answer: data.answer ?? null,
    mode: data.mode, status: 'active',
    parentQid: data.parentQid ?? null,
    relatedQids: data.relatedQids ?? [],
    tags: data.tags ?? [],
    sources: data.sources ?? [],
    createdAt: now, updatedAt: now,
    answeredAt: data.mode === 'deep' ? now : null,
    visitCount: 0,
  };
}

export function getEntryByQid(qid: number): QaEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM qa_entries WHERE qid = ?').get(qid);
  if (!row) return null;

  // Increment visit count
  db.prepare('UPDATE qa_entries SET visit_count = visit_count + 1 WHERE qid = ?').run(qid);

  return rowToQaEntry(row);
}

export function getEntryBySessionId(sessionId: string): QaEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM qa_entries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(sessionId);
  return row ? rowToQaEntry(row) : null;
}

export function getEntryDetail(qid: number): QaEntryDetail | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT e.*,
           (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count
    FROM qa_entries e WHERE e.qid = ?
  `).get(qid);
  if (!row) return null;

  // Increment visit count
  db.prepare('UPDATE qa_entries SET visit_count = visit_count + 1 WHERE qid = ?').run(qid);

  const entry = rowToQaEntry(row);
  const isCalibrated = !!(row as any).calibrated_count;

  // Get calibrated answer
  let calibratedAnswer: CalibratedAnswer | null = null;
  if (isCalibrated) {
    calibratedAnswer = getCalibratedAnswer(entry.id);
  }

  // Get children (questions that have this as parent)
  const childRows = db.prepare(
    'SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count FROM qa_entries e WHERE e.parent_qid = ? ORDER BY e.created_at ASC'
  ).get(qid);
  const children = childRows ? [rowToSummary(childRows as any)] : [];

  return {
    ...entry,
    isCalibrated,
    calibratedAnswer,
    children,
  };
}

export function listEntries(query: QaListQuery): { entries: QaEntrySummary[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (query.repo) {
    conditions.push('e.repo = ?');
    params.push(query.repo);
  }
  if (query.mode) {
    conditions.push('e.mode = ?');
    params.push(query.mode);
  }
  if (query.status) {
    conditions.push('e.status = ?');
    params.push(query.status);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count
  const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM qa_entries e ${where}`).get(...params);
  const total = (countRow as any).cnt;

  // Sort
  let orderBy = 'ORDER BY e.created_at DESC';
  if (query.sort === 'popular') {
    orderBy = 'ORDER BY e.visit_count DESC, e.created_at DESC';
  } else if (query.sort === 'visit') {
    orderBy = 'ORDER BY e.visit_count DESC';
  }

  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count
    FROM qa_entries e ${where} ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    entries: (rows as any[]).map(rowToSummary),
    total,
  };
}

export function updateEntry(qid: number, data: {
  module?: string | null;
  answer?: string | null;
  status?: 'active' | 'archived';
  relatedQids?: number[];
  tags?: string[];
}): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (data.module !== undefined) {
    sets.push('module = ?');
    params.push(data.module);
  }
  if (data.answer !== undefined) {
    sets.push('answer = ?');
    params.push(data.answer);
  }
  if (data.status !== undefined) {
    sets.push('status = ?');
    params.push(data.status);
  }
  if (data.relatedQids !== undefined) {
    sets.push('related_qids = ?');
    params.push(toJsonArray(data.relatedQids));
  }
  if (data.tags !== undefined) {
    sets.push('tags = ?');
    params.push(toJsonArray(data.tags));
  }

  params.push(qid);
  const result = db.prepare(`UPDATE qa_entries SET ${sets.join(', ')} WHERE qid = ?`).run(...params);
  return (result as any).changes > 0;
}

// ── Related Q&A ────────────────────────────────────────────────

/**
 * Get the related chain for a #Q entry:
 * - its parent (if any)
 * - its children (questions derived from it)
 * - manually linked related Q&As
 */
export function getRelatedChain(qid: number): {
  parent: QaEntrySummary | null;
  children: QaEntrySummary[];
  related: QaEntrySummary[];
} {
  const db = getDb();
  const entry = getEntryByQid(qid);
  if (!entry) return { parent: null, children: [], related: [] };

  let parent: QaEntrySummary | null = null;
  if (entry.parentQid) {
    const row = db.prepare(
      'SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count FROM qa_entries e WHERE e.qid = ?'
    ).get(entry.parentQid);
    if (row) parent = rowToSummary(row as any);
  }

  const childRows = db.prepare(
    'SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count FROM qa_entries e WHERE e.parent_qid = ? ORDER BY e.created_at ASC'
  ).all(qid);
  const children: QaEntrySummary[] = (childRows as any[]).map(rowToSummary);

  let related: QaEntrySummary[] = [];
  if (entry.relatedQids.length > 0) {
    const placeholders = entry.relatedQids.map(() => '?').join(',');
    const relRows = db.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count FROM qa_entries e WHERE e.qid IN (${placeholders}) ORDER BY e.created_at DESC`
    ).all(...entry.relatedQids);
    related = (relRows as any[]).map(rowToSummary);
  }

  return { parent, children, related };
}

/**
 * Link one #Q to another (add to relatedQids).
 * Bidirectional: if A links to B, B also gets A in its relatedQids.
 */
export function linkEntries(sourceQid: number, targetQid: number): boolean {
  const db = getDb();
  const source = getEntryByQid(sourceQid);
  const target = getEntryByQid(targetQid);
  if (!source || !target) return false;

  const now = new Date().toISOString();

  // Add target to source's relatedQids
  const srcRel = source.relatedQids.includes(targetQid)
    ? source.relatedQids
    : [...source.relatedQids, targetQid];
  db.prepare('UPDATE qa_entries SET related_qids = ?, updated_at = ? WHERE qid = ?').run(
    toJsonArray(srcRel), now, sourceQid
  );

  // Add source to target's relatedQids
  const tgtRel = target.relatedQids.includes(sourceQid)
    ? target.relatedQids
    : [...target.relatedQids, sourceQid];
  db.prepare('UPDATE qa_entries SET related_qids = ?, updated_at = ? WHERE qid = ?').run(
    toJsonArray(tgtRel), now, targetQid
  );

  return true;
}

// ── Calibrated Answers ─────────────────────────────────────────

export function upsertCalibratedAnswer(data: {
  qaEntryId: string;
  answer: string;
  calibrator?: string;
  reason?: string | null;
}): CalibratedAnswer {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM calibrated_answers WHERE qa_entry_id = ?').get(data.qaEntryId) as any;

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE calibrated_answers SET answer = ?, reason = ?, version = version + 1, updated_at = ?
      WHERE qa_entry_id = ?
    `).run(data.answer, data.reason ?? null, now, data.qaEntryId);
    return {
      id: existing.id,
      qaEntryId: data.qaEntryId,
      answer: data.answer,
      calibrator: data.calibrator ?? existing.calibrator,
      reason: data.reason ?? existing.reason,
      version: (existing.version || 0) + 1,
      createdAt: existing.created_at,
      updatedAt: now,
    };
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO calibrated_answers (id, qa_entry_id, answer, calibrator, reason, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, data.qaEntryId, data.answer, data.calibrator ?? '', data.reason ?? null, now, now);

  return {
    id,
    qaEntryId: data.qaEntryId,
    answer: data.answer,
    calibrator: data.calibrator ?? '',
    reason: data.reason ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function getCalibratedAnswer(qaEntryId: string): CalibratedAnswer | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM calibrated_answers WHERE qa_entry_id = ?').get(qaEntryId);
  if (!row) return null;
  const r = row as any;
  return {
    id: r.id,
    qaEntryId: r.qa_entry_id,
    answer: r.answer,
    calibrator: r.calibrator,
    reason: r.reason,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getOrphanedCalibratedAnswers(): { qid: number; question: string; answer: string; updatedAt: string }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.qid, e.question, ca.answer, ca.updated_at
    FROM calibrated_answers ca
    JOIN qa_entries e ON e.id = ca.qa_entry_id
    WHERE e.mode = 'deep'
    ORDER BY ca.updated_at DESC
    LIMIT 50
  `).all();
  return (rows as any[]).map(r => ({
    qid: r.qid,
    question: r.question,
    answer: r.answer,
    updatedAt: r.updated_at,
  }));
}

// ── Search Integration (for codegraph_search priority boosting) ─

export function searchCalibratedEntries(query: string, limit = 5): QaEntrySummary[] {
  const db = getDb();
  const like = `%${query.replace(/[%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count
    FROM qa_entries e
    WHERE e.question LIKE ? AND (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) > 0
    ORDER BY e.visit_count DESC, e.created_at DESC
    LIMIT ?
  `).all(like, limit);
  return (rows as any[]).map(rowToSummary);
}

/**
 * Search entries by question text (lightweight, for in-page search / autocomplete).
 */
export function searchEntries(query: string, limit = 10, repo?: string): QaEntrySummary[] {
  const db = getDb();
  const like = `%${query.replace(/[%_]/g, '\\$&')}%`;
  let sql = `
    SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count
    FROM qa_entries e
    WHERE e.question LIKE ?
  `;
  const params: any[] = [like];
  if (repo) {
    sql += ' AND e.repo = ?';
    params.push(repo);
  }
  sql += ' ORDER BY e.visit_count DESC, e.created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return (rows as any[]).map(rowToSummary);
}
