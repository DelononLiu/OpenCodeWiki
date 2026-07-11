/**
 * qa-store.test.ts — FTS5 单元测试
 *
 * 测试 FTS5 虚拟表的自动同步：插入/更新/删除 qa_entries 时，
 * qa_entries_fts 索引自动更新，并支持 MATCH 全文搜索。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('qa-store FTS5', () => {
  let mod: Awaited<typeof import('./qa-store.js')>;
  let tmpDir: string;
  let origHome: string | undefined;
  let origDataDir: string | undefined;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-store-test-'));
    origHome = process.env.HOME;
    origDataDir = process.env.OPENCODEWIKI_QA_DATA_DIR;
    // Set env to use temp dir
    process.env.OPENCODEWIKI_QA_DATA_DIR = tmpDir;
    mod = await import('./qa-store.js');
  });

  after(() => {
    if (mod) mod.closeDb();
    process.env.HOME = origHome ?? '';
    if (origDataDir) {
      process.env.OPENCODEWIKI_QA_DATA_DIR = origDataDir;
    } else {
      delete process.env.OPENCODEWIKI_QA_DATA_DIR;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper: get the implicit SQLite rowid for an entry by qid */
  function getRowid(qid: number): number {
    const row = mod.getQaDb()
      .prepare('SELECT rowid FROM qa_entries WHERE qid = ?')
      .get(qid) as { rowid: number };
    return row.rowid;
  }

  it('getQaDb 返回单例', () => {
    const db1 = mod.getQaDb();
    const db2 = mod.getQaDb();
    assert.strictEqual(db1, db2, '多次调用返回同一 DatabaseSync 实例');
  });

  it('FTS5 虚拟表存在', () => {
    const db = mod.getQaDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qa_entries_fts'")
      .all() as { name: string }[];
    assert.strictEqual(rows.length, 1, 'qa_entries_fts 表存在');

    // 确认触发器存在
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'qa_fts_%'")
      .all() as { name: string }[];
    const triggerNames = triggers.map((t) => t.name);
    assert.ok(triggerNames.includes('qa_fts_insert'), 'INSERT 触发器存在');
    assert.ok(triggerNames.includes('qa_fts_delete'), 'DELETE 触发器存在');
    assert.ok(triggerNames.includes('qa_fts_update'), 'UPDATE 触发器存在');
  });

  it('插入条目自动填充 FTS 索引', () => {
    const db = mod.getQaDb();

    // Get initial FTS count
    const beforeCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM qa_entries_fts')
      .get() as { cnt: number }).cnt;

    // Create an entry through the public API
    const entry = mod.createEntry({
      sessionId: 'fts-test-session',
      repo: 'test-repo',
      question: '什么是 FTS5 全文搜索引擎',
      mode: 'deep',
    });

    // Verify FTS row count increased
    const afterCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM qa_entries_fts')
      .get() as { cnt: number }).cnt;
    assert.strictEqual(afterCount, beforeCount + 1, 'FTS 表行数增加');
  });

  it('FTS5 MATCH 搜索可检索到条目', () => {
    const db = mod.getQaDb();

    // Create entry with distinct search term (avoid special FTS5 chars like '.')
    mod.createEntry({
      sessionId: 'fts-test-session-2',
      repo: 'test-repo',
      question: '如何优化 Node 数据库查询性能',
      mode: 'deep',
    });

    // Search using FTS5 MATCH
    const results = db
      .prepare(
        'SELECT rowid, question FROM qa_entries_fts WHERE qa_entries_fts MATCH ?'
      )
      .all('Node') as { rowid: number; question: string }[];
    assert.ok(results.length >= 1, 'MATCH 搜索返回结果');
  });

  it('更新问题更新 FTS 索引', () => {
    const db = mod.getQaDb();

    const entry = mod.createEntry({
      sessionId: 'fts-test-session-3',
      repo: 'test-repo',
      question: '旧版问题：如何安装 Python',
      mode: 'deep',
    });
    const rowid = getRowid(entry.qid);

    // Verify it matches "Python"
    const beforeResults = db
      .prepare('SELECT rowid FROM qa_entries_fts WHERE qa_entries_fts MATCH ?')
      .all('Python') as { rowid: number }[];
    assert.ok(beforeResults.some((r) => r.rowid === rowid), '插入后 Python 可被搜索');

    // Directly update the question via raw SQL to test the UPDATE trigger
    db.prepare('UPDATE qa_entries SET question = ? WHERE qid = ?').run(
      '新版问题：如何安装 Node', entry.qid
    );

    // Verify old term "Python" is gone from FTS for this row
    const oldResults = db
      .prepare('SELECT rowid FROM qa_entries_fts WHERE qa_entries_fts MATCH ?')
      .all('Python') as { rowid: number }[];
    const oldMatch = oldResults.some((r) => r.rowid === rowid);
    assert.ok(!oldMatch, '旧问题已从 FTS 索引移除');

    // Verify new term "Node" is in FTS for this row
    const newResults = db
      .prepare('SELECT rowid FROM qa_entries_fts WHERE qa_entries_fts MATCH ?')
      .all('Node') as { rowid: number }[];
    const newMatch = newResults.some((r) => r.rowid === rowid);
    assert.ok(newMatch, '新问题已加入 FTS 索引');
  });

  it('删除条目从 FTS 索引移除', () => {
    const db = mod.getQaDb();

    const entry = mod.createEntry({
      sessionId: 'fts-test-session-4',
      repo: 'test-repo',
      question: '临时问题：将被删除',
      mode: 'deep',
    });
    const rowid = getRowid(entry.qid);

    // Verify it exists in FTS
    const beforeRow = db
      .prepare('SELECT rowid FROM qa_entries_fts WHERE rowid = ?')
      .get(rowid) as { rowid: number } | undefined;
    assert.ok(beforeRow, '删除前 FTS 索引存在');

    // Delete via raw SQL (trigger handles it)
    db.prepare('DELETE FROM qa_entries WHERE qid = ?').run(entry.qid);

    // Verify removed from FTS
    const afterRow = db
      .prepare('SELECT rowid FROM qa_entries_fts WHERE rowid = ?')
      .get(rowid) as { rowid: number } | undefined;
    assert.strictEqual(afterRow, undefined, '删除后 FTS 索引已移除条目');
  });
});
