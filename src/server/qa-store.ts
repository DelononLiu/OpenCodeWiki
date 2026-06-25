/**
 * qa-store.ts — SQLite 持久化层 for #Q 问答沉淀体系
 *
 * 独立 SQLite 数据库 `~/.opencodewiki/qa.db`，与 codebase-memory-mcp 索引库分离。
 * 使用 Node 内置 node:sqlite (DatabaseSync), 无需安装 better-sqlite3。
 */

import { randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ── Types ──────────────────────────────────────────────────────

export type Domain = 'general' | 'log-analysis' | 'stack-analysis' | 'bug-analysis' | 'build-issue' | 'program-analysis';

export const DOMAINS: Domain[] = ['general', 'log-analysis', 'stack-analysis', 'bug-analysis', 'build-issue', 'program-analysis'];

export const DOMAIN_LABELS: Record<Domain, string> = {
  general: '通用',
  'log-analysis': '日志分析',
  'stack-analysis': '堆栈分析',
  'bug-analysis': '缺陷分析',
  'build-issue': '编译构建',
  'program-analysis': '程序分析',
};

export interface QaEntry {
  id: string;
  qid: number;
  sessionId: string;
  repo: string;
  module: string | null;
  question: string;
  answer: string | null;
  mode: 'lightweight' | 'deep';
  status: 'active' | 'pending' | 'archived';
  parentQid: number | null;
  relatedQids: number[];
  tags: string[];
  sources: any[];
  domain: Domain;
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
  sessionId: string;
  question: string;
  mode: 'lightweight' | 'deep';
  status: 'active' | 'pending' | 'archived';
  repo: string;
  module: string | null;
  parentQid: number | null;
  domain: Domain;
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
  domain?: Domain;
  calibrated?: boolean;
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
    domain        TEXT NOT NULL DEFAULT 'general',
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('active','pending','archived')),
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
  // Create tables first (IF NOT EXISTS)
  _db.exec(SQL_CREATE_TABLES);
  // Migrate: add domain column if missing (old db created before domain was introduced)
  const cols = _db.prepare("PRAGMA table_info('qa_entries')").all() as any[];
  if (!cols.some((c: any) => c.name === 'domain')) {
    _db.exec("ALTER TABLE qa_entries ADD COLUMN domain TEXT NOT NULL DEFAULT 'general'");
    // Re-create domain index now that the column exists
    try { _db.exec('CREATE INDEX IF NOT EXISTS idx_qa_domain ON qa_entries(domain)'); } catch {}
  }
  // Migrate: update CHECK constraint to allow 'pending' status (for待审区)
  try {
    // Test if 'pending' can be inserted (fails if old constraint active)
    _db.prepare("INSERT INTO qa_entries (id, qid, session_id, repo, question, mode, status) VALUES ('__migrate_test__', -1, '__test__', '__test__', '__test__', 'lightweight', 'pending')").run();
    _db.prepare("DELETE FROM qa_entries WHERE id = '__migrate_test__'").run();
  } catch {
    // Old constraint doesn't allow 'pending' — recreate table
    _db.exec("ALTER TABLE qa_entries RENAME TO qa_entries_old");
    _db.exec(SQL_CREATE_TABLES);
    _db.exec("INSERT INTO qa_entries (id, qid, session_id, repo, module, question, answer, mode, domain, status, parent_qid, related_qids, tags, sources, created_at, updated_at, answered_at, visit_count) SELECT id, qid, session_id, repo, module, question, answer, mode, COALESCE(domain, 'general'), status, parent_qid, related_qids, tags, sources, created_at, updated_at, answered_at, visit_count FROM qa_entries_old");
    _db.exec("DROP TABLE qa_entries_old");
    console.log('[qa-store] migrated status constraint to allow pending');
  }
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
    domain: row.domain || 'general',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: row.answered_at,
    visitCount: row.visit_count,
  };
}

function rowToSummary(row: any): QaEntrySummary {
  return {
    qid: row.qid,
    sessionId: row.session_id,
    question: row.question,
    mode: row.mode,
    status: row.status,
    repo: row.repo,
    module: row.module,
    parentQid: row.parent_qid,
    domain: row.domain || 'general',
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
  domain?: Domain;
  parentQid?: number | null;
  relatedQids?: number[];
  tags?: string[];
  sources?: any[];
}): QaEntry {
  const db = getDb();
  const id = randomUUID();
  const qid = nextQid();
  const now = new Date().toISOString();
  const domain = data.domain || 'general';

  db.prepare(`
    INSERT INTO qa_entries (id, qid, session_id, repo, module, question, answer, mode, domain, status, parent_qid, related_qids, tags, sources, created_at, updated_at, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, qid, data.sessionId, data.repo,
    data.module ?? null, data.question,
    data.answer ?? null, data.mode, domain, 'pending',
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
    mode: data.mode, domain: domain as Domain, status: 'pending',
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

  // 默认只查询 active 条目（已通过待审区），除非显式指定 status
  if (!query.status) {
    conditions.push("e.status = 'active'");
  }
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
  if (query.domain) {
    conditions.push('e.domain = ?');
    params.push(query.domain);
  }
  if (query.calibrated) {
    conditions.push('(SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) > 0');
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
  domain?: Domain;
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
  if (data.domain !== undefined) {
    sets.push('domain = ?');
    params.push(data.domain);
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

// ── 待审区操作 ─────────────────────────────────────────────────────

/**
 * 手动通过待审区：将 pending 条目标为 active。
 * 通常在校准操作中自动完成，此处提供批量/单独手动审批接口。
 */
export function approveEntry(qid: number): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE qa_entries SET status = 'active', updated_at = ? WHERE qid = ? AND status = 'pending'").run(now, qid);
  return (result as any).changes > 0;
}

/**
 * 列出待审条目（用于审核界面展示）。
 */
export function listPendingEntries(repo?: string): QaEntrySummary[] {
  const db = getDb();
  let sql = "SELECT e.*, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = e.id) AS calibrated_count FROM qa_entries e WHERE e.status = 'pending'";
  const params: any[] = [];
  if (repo) {
    sql += ' AND e.repo = ?';
    params.push(repo);
  }
  sql += ' ORDER BY e.created_at DESC LIMIT 50';
  const rows = db.prepare(sql).all(...params);
  return (rows as any[]).map(rowToSummary);
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
    // 校准后自动设为 active（通过待审区）
    try {
    db.prepare("UPDATE qa_entries SET status = 'active', updated_at = ? WHERE id = ?").run(now, data.qaEntryId);
  } catch {
    // status already active or migration state, non-fatal
  }
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
  // 首次校准后自动通过待审区
  try {
    db.prepare("UPDATE qa_entries SET status = 'active', updated_at = ? WHERE id = ?").run(now, data.qaEntryId);
  } catch {
    // status already active or migration state, non-fatal
  }

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
export function searchEntries(query: string, limit = 10, repo?: string, domain?: Domain): QaEntrySummary[] {
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
  if (domain) {
    sql += ' AND e.domain = ?';
    params.push(domain);
  }
  sql += ' ORDER BY e.visit_count DESC, e.created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return (rows as any[]).map(rowToSummary);
}

// ── Domain backfill ──────────────────────────────────────────────

export function backfillDomain(): number {
  const db = getDb();
  const result = db.prepare("UPDATE qa_entries SET domain = 'general' WHERE domain IS NULL OR domain = ''").run();
  return (result as any).changes || 0;
}
