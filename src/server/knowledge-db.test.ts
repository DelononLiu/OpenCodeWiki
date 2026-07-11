/**
 * knowledge-db.test.ts — 单元测试
 *
 * 使用临时目录 + HOME 覆盖，避免污染真实 DB 路径。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('knowledge-db', () => {
  let mod: Awaited<typeof import('./knowledge-db.js')>;
  let tmpDir: string;
  let origHome: string | undefined;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-db-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    mod = await import('./knowledge-db.js');
  });

  after(() => {
    if (mod) mod.closeKnowledgeDb();
    process.env.HOME = origHome ?? '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initKnowledgeDb 创建所有表', () => {
    mod.initKnowledgeDb();
    const db = mod.getKnowledgeDb();

    // 校验所有实体表存在
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    assert.ok(names.includes('entities'), 'entities 表存在');
    assert.ok(names.includes('entity_files'), 'entity_files 表存在');
    assert.ok(names.includes('entity_relations'), 'entity_relations 表存在');
    assert.ok(names.includes('entity_qa'), 'entity_qa 表存在');

    // 校验 FTS 虚拟表存在（FTS5 虚拟表在 sqlite_master 中 type='table'）
    const fts = db
      .prepare("SELECT name FROM sqlite_master WHERE name='entities_fts'")
      .all() as { name: string }[];
    assert.strictEqual(fts.length, 1, 'entities_fts FTS 表存在');

    // 校验 CHECK 约束（status 字段）
    const createSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'")
      .all() as { sql: string }[];
    assert.ok(
      createSql[0].sql.includes("CHECK(status IN ('draft','reviewed','published'))"),
      'status CHECK 约束存在',
    );
  });

  it('getKnowledgeDb 返回单例', () => {
    const db1 = mod.getKnowledgeDb();
    const db2 = mod.getKnowledgeDb();
    assert.strictEqual(db1, db2, '多次调用返回同一实例');
  });

  it('closeKnowledgeDb 重置单例', () => {
    const db1 = mod.getKnowledgeDb();
    mod.closeKnowledgeDb();
    const db2 = mod.getKnowledgeDb();
    assert.notStrictEqual(db1, db2, '关闭后重新获取为新实例');
  });

  it('重复 initKnowledgeDb 幂等', () => {
    // 多次调用不应报错
    mod.initKnowledgeDb();
    mod.initKnowledgeDb();
    mod.initKnowledgeDb();
    const db = mod.getKnowledgeDb();
    // FTS5 会创建影子表，所以总表数会变化；仅校验 4 个实体表仍存在
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities','entity_files','entity_relations','entity_qa')")
      .all() as { name: string }[];
    assert.strictEqual(tables.length, 4, '实体表数量不变');
  });

  it('entity_qa 表有唯一索引支持 INSERT OR IGNORE 去重', () => {
    const db = mod.getKnowledgeDb();

    // Verify the unique index exists
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_entity_qa'")
      .all() as { name: string }[];
    assert.strictEqual(indexes.length, 1, 'idx_entity_qa 唯一索引存在');

    // Insert a test entity first to satisfy foreign key constraint
    db.prepare("INSERT OR IGNORE INTO entities(slug, name) VALUES(?, ?)").run('test-entity', 'Test Entity');

    // Verify INSERT OR IGNORE works by inserting a duplicate
    db.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?, ?)').run('test-entity', 1);
    db.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?, ?)').run('test-entity', 1);

    const count = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa WHERE entity_slug = ? AND qid = ?')
      .get('test-entity', 1) as { cnt: number }).cnt;
    assert.strictEqual(count, 1, '重复插入应被忽略，只保留一行');
  });
});
