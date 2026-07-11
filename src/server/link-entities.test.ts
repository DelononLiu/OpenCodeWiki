/**
 * link-entities.test.ts — linkAnswerToEntities 单元测试
 *
 * 测试 QA 回答后自动关联实体的功能：
 * 1. 从问题文本中匹配实体
 * 2. 从回答中的 #slug 标记提取实体
 * 3. 将关联写入 entity_qa 表
 * 4. 边界情况：无匹配实体、无 qid、数据库错误不崩溃
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('linkAnswerToEntities', () => {
  let mod: Awaited<typeof import('./qa-endpoint.js')>;
  let kbMod: Awaited<typeof import('./knowledge-db.js')>;
  let tmpDir: string;
  let origHome: string | undefined;

  before(async () => {
    // Setup temp directory for knowledge.db and qa.db
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-entities-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;

    // Also set OPENCODEWIKI_QA_DATA_DIR for qa-store
    process.env.OPENCODEWIKI_QA_DATA_DIR = tmpDir;

    // Initialize knowledge database with test entities
    kbMod = await import('./knowledge-db.js');
    const db = kbMod.getKnowledgeDb();

    // Insert test entities
    db.prepare(`
      INSERT INTO entities (slug, name, definition, status) VALUES (?, ?, ?, 'published')
    `).run('node-js', 'Node.js', 'A JavaScript runtime built on V8 engine');

    db.prepare(`
      INSERT INTO entities (slug, name, definition, status) VALUES (?, ?, ?, 'published')
    `).run('typescript', 'TypeScript', 'A typed superset of JavaScript');

    db.prepare(`
      INSERT INTO entities (slug, name, definition, status) VALUES (?, ?, ?, 'published')
    `).run('sqlite', 'SQLite', 'A C library that implements a small SQL database engine');

    db.prepare(`
      INSERT INTO entities (slug, name, definition, status) VALUES (?, ?, ?, 'published')
    `).run('express-js', 'Express.js', 'A web application framework for Node.js');

    // Import the module under test
    mod = await import('./qa-endpoint.js');
  });

  after(() => {
    if (kbMod) kbMod.closeKnowledgeDb();
    process.env.HOME = origHome ?? '';
    const qaDirKey = 'OPENCODEWIKI_QA_DATA_DIR';
    if (process.env[qaDirKey]) delete process.env[qaDirKey];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('linkAnswerToEntities 函数存在并可调用', async () => {
    assert.ok(typeof mod.linkAnswerToEntities === 'function', 'linkAnswerToEntities 应为一个函数');
    // 调用不崩溃即可
    await mod.linkAnswerToEntities('test question', 'test answer', 1);
  });

  it('从问题文本匹配实体并写入 entity_qa', async () => {
    const db = kbMod.getKnowledgeDb();

    // Count existing entity_qa rows
    const beforeCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa')
      .get() as { cnt: number }).cnt;

    // Question mentions "Node.js" which should match the entity name
    await mod.linkAnswerToEntities(
      'How to optimize Node.js performance?',
      'Use worker threads for better performance.',
      10001,
    );

    const afterCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa')
      .get() as { cnt: number }).cnt;

    // Should have inserted at least 1 association
    assert.ok(afterCount > beforeCount, 'entity_qa 应插入新行');

    // Verify the association is correct
    const rows = db
      .prepare('SELECT entity_slug, qid FROM entity_qa WHERE qid = ?')
      .all(10001) as { entity_slug: string; qid: number }[];

    assert.ok(rows.some((r) => r.entity_slug === 'node-js'), '应关联 node-js 实体');
    assert.strictEqual(rows[0].qid, 10001, 'qid 应为 10001');
  });

  it('从回答中的 #slug 标记提取实体', async () => {
    const db = kbMod.getKnowledgeDb();

    await mod.linkAnswerToEntities(
      'What database should I use?',
      'You should use #sqlite for embedded storage and #express-js for the web layer. Also consider #typescript for type safety.',
      10002,
    );

    const rows = db
      .prepare('SELECT entity_slug FROM entity_qa WHERE qid = ?')
      .all(10002) as { entity_slug: string }[];

    const slugs = rows.map((r) => r.entity_slug);
    assert.ok(slugs.includes('sqlite'), '应关联 sqlite 实体');
    assert.ok(slugs.includes('express-js'), '应关联 express-js 实体');
    assert.ok(slugs.includes('typescript'), '应关联 typescript 实体');
  });

  it('同时从问题和回答匹配实体', async () => {
    const db = kbMod.getKnowledgeDb();

    // Question mentions "TypeScript" (match by name), answer has #node-js
    await mod.linkAnswerToEntities(
      'TypeScript type system',
      'See #node-js for runtime details.',
      10003,
    );

    const rows = db
      .prepare('SELECT entity_slug FROM entity_qa WHERE qid = ?')
      .all(10003) as { entity_slug: string }[];

    const slugs = rows.map((r) => r.entity_slug);
    assert.ok(slugs.includes('typescript'), '问题应匹配 typescript');
    assert.ok(slugs.includes('node-js'), '回答 #slug 应匹配 node-js');
  });

  it('无匹配实体时不做任何操作（不报错）', async () => {
    const db = kbMod.getKnowledgeDb();

    const beforeCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa')
      .get() as { cnt: number }).cnt;

    // Question and answer don't mention any known entities
    await mod.linkAnswerToEntities(
      'What is the meaning of life?',
      'The answer is 42.',
      10004,
    );

    const afterCount = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa')
      .get() as { cnt: number }).cnt;

    assert.strictEqual(afterCount, beforeCount, '无匹配实体时不应插入新行');
  });

  it('qid 为 undefined 时跳过（不报错）', async () => {
    // Should not throw when qid is undefined
    await mod.linkAnswerToEntities(
      'How to use Node.js?',
      'Use #node-js runtime.',
      undefined as any,
    );
  });

  it('同 qid 的重复关联不应产生重复行（INSERT OR IGNORE）', async () => {
    const db = kbMod.getKnowledgeDb();

    // First call
    await mod.linkAnswerToEntities('Node.js performance', 'Use #node-js', 10005);
    const count1 = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa WHERE qid = ? AND entity_slug = ?')
      .get(10005, 'node-js') as { cnt: number }).cnt;

    // Second call with same match
    await mod.linkAnswerToEntities('Node.js performance', 'Use #node-js', 10005);
    const count2 = (db
      .prepare('SELECT COUNT(*) AS cnt FROM entity_qa WHERE qid = ? AND entity_slug = ?')
      .get(10005, 'node-js') as { cnt: number }).cnt;

    assert.strictEqual(count2, count1, '重复调用不应增加行数');
  });
});
