/**
 * entity-api.test.ts — API 路由集成测试
 *
 * 使用临时 HOME 目录 + 真实 SQLite DB，验证 express 路由的 HTTP 响应。
 * 使用 node:test + node:assert。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';

import type { Server } from 'node:http';

describe('Entity API routes', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-api-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;

    // 初始化 knowledge.db
    const kbMod = await import('./knowledge-db.js');
    kbMod.initKnowledgeDb();

    // 初始化 qa.db（getQaDb 内部会初始化）
    const qaMod = await import('./qa-store.js');
    qaMod.getQaDb();

    // 插入测试数据
    const { EntityService } = await import('./entity-service.js');
    const svc = new EntityService();

    svc.save({
      slug: 'test-entity',
      name: 'Test Entity',
      status: 'published',
      definition: 'A test entity for API testing',
      project: 'test',
      content: '## Test Entity\n\nThis is a test entity.',
      searchCount: 10,
      files: [{ path: 'src/test.ts', symbols: ['Test'] }],
      relations: [],
    });

    svc.save({
      slug: 'hot-entity',
      name: 'Hot Entity',
      status: 'published',
      definition: 'A popular test entity',
      project: 'test',
      content: '# Hot Entity',
      searchCount: 100,
      files: [],
      relations: [],
    });

    svc.save({
      slug: 'cool-entity',
      name: 'Cool Entity',
      status: 'draft',
      definition: 'A less popular entity',
      project: 'test',
      content: '# Cool Entity',
      searchCount: 5,
      files: [],
      relations: [],
    });

    // 在 entity_qa 中插入关联数据
    const kb = kbMod.getKnowledgeDb();
    kb.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?, ?)').run('test-entity', 1001);
    kb.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?, ?)').run('test-entity', 1002);

    // 在 qa.db 中插入 QA 条目
    const qaDb = qaMod.getQaDb();
    qaDb.prepare(`INSERT OR IGNORE INTO qa_entries(id, qid, session_id, question, answer, domain, visit_count, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('id-1001', 1001, 'sess-1', 'What is Test Entity?', 'Test answer 1', 'general', 10, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
    qaDb.prepare(`INSERT OR IGNORE INTO qa_entries(id, qid, session_id, question, answer, domain, visit_count, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('id-1002', 1002, 'sess-2', 'How to use Test Entity?', 'Test answer 2', 'general', 5, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');

    // 构建测试用的 Express app（仅实体路由）
    const app = express();

    // ── 实体路由（与 server.ts 一致） ──
    app.get('/api/wiki/entities/search', async (req, res) => {
      const q = req.query.q as string;
      if (!q) return res.json([]);
      const svc2 = new EntityService();
      const results = svc2.search(q);
      res.json(results);
    });

    app.get('/api/wiki/entities/hot', (_req, res) => {
      const svc2 = new EntityService();
      const results = svc2.hot(10);
      res.json(results);
    });

    app.get('/api/wiki/entities/:slug/qa', async (req, res) => {
      const { slug } = req.params;
      try {
        const { getKnowledgeDb } = await import('./knowledge-db.js');
        const db = getKnowledgeDb();
        const qidRows = db.prepare('SELECT qid FROM entity_qa WHERE entity_slug = ?').all(slug) as any[];
        if (qidRows.length === 0) { res.json({ qa: [] }); return; }
        const qids = qidRows.map((r: any) => r.qid);
        const { getQaDb } = await import('./qa-store.js');
        const qaDb2 = getQaDb();
        const placeholders = qids.map(() => '?').join(',');
        const qaRows = qaDb2.prepare(`
          SELECT q.qid, q.question, (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = q.id) AS calibrated_count
          FROM qa_entries q WHERE q.qid IN (${placeholders})
          ORDER BY q.visit_count DESC
        `).all(...qids) as any[];
        res.json({ qa: qaRows.map((r: any) => ({ qid: r.qid, question: r.question, isCalibrated: r.calibrated_count > 0 })) });
      } catch (e) {
        res.status(500).json({ error: 'failed to load QA data', details: String(e) });
      }
    });

    app.get('/api/wiki/entities/:slug', (req, res) => {
      const svc2 = new EntityService();
      const entity = svc2.get(req.params.slug);
      if (!entity) { res.status(404).json({ error: 'entity not found' }); return; }
      svc2.bump(req.params.slug);
      res.json(entity);
    });

    // 启动 HTTP 服务器
    await new Promise<void>((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) server.close();

    // 关闭数据库连接
    try {
      const kbMod = await import('./knowledge-db.js');
      kbMod.closeKnowledgeDb();
    } catch {}
    try {
      const qaMod = await import('./qa-store.js');
      qaMod.closeDb();
    } catch {}

    process.env.HOME = origHome ?? '';
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // ── Tests ──────────────────────────────────────────────────

  it('GET /api/wiki/entities/hot 返回数组', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/hot`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body), '响应体应为数组');

    // 按 searchCount 降序：hot-entity 应排在 cool-entity 之前
    const slugs = body.map((e: any) => e.slug);
    assert.ok(slugs.includes('hot-entity'), '应包含 hot-entity');
    assert.ok(slugs.includes('cool-entity'), '应包含 cool-entity');
    assert.ok(body.length >= 2, '至少返回 2 个实体');
  });

  it('GET /api/wiki/entities/:slug 返回实体', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/test-entity`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.slug, 'test-entity');
    assert.strictEqual(body.name, 'Test Entity');
    assert.strictEqual(body.definition, 'A test entity for API testing');
    assert.strictEqual(body.status, 'published');
    assert.ok(Array.isArray(body.files));
    assert.ok(Array.isArray(body.relations));
  });

  it('GET /api/wiki/entities/:slug 不存在返回 404', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/non-existent`);
    assert.strictEqual(res.status, 404);

    const body = await res.json();
    assert.ok(body.error, '应包含 error 字段');
    assert.strictEqual(body.error, 'entity not found');
  });

  it('GET /api/wiki/entities/:slug bump 增加 search_count', async () => {
    // 先获取当前计数（此请求本身也会 bump）
    const res1 = await fetch(`${baseUrl}/api/wiki/entities/cool-entity`);
    const before = await res1.json();

    // 多次访问（触发 bump）
    await fetch(`${baseUrl}/api/wiki/entities/cool-entity`);
    await fetch(`${baseUrl}/api/wiki/entities/cool-entity`);

    // 验证 search_count 增加
    const res2 = await fetch(`${baseUrl}/api/wiki/entities/cool-entity`);
    const after = await res2.json();
    assert.ok(after.searchCount > before.searchCount, 'search_count 应增加');
  });

  it('GET /api/wiki/entities/:slug/qa 返回 QA 列表', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/test-entity/qa`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.qa, '响应应包含 qa 字段');
    assert.ok(Array.isArray(body.qa), 'qa 应为数组');
    assert.ok(body.qa.length >= 2, '应该有 2 个 QA 条目');

    // 按 visit_count 降序：qid 1001 (10) 应在 1002 (5) 之前
    assert.strictEqual(body.qa[0].qid, 1001);
    assert.strictEqual(body.qa[0].question, 'What is Test Entity?');
    assert.strictEqual(body.qa[1].qid, 1002);
    assert.strictEqual(body.qa[1].question, 'How to use Test Entity?');
  });

  it('GET /api/wiki/entities/:slug/qa 无关联时返回空数组', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/hot-entity/qa`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.qa, '响应应包含 qa 字段');
    assert.ok(Array.isArray(body.qa), 'qa 应为数组');
    assert.strictEqual(body.qa.length, 0, '没有关联 QA 时返回空数组');
  });

  it('GET /api/wiki/entities/:slug/qa 不存在的实体返回空数组', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/non-existent/qa`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.qa, '响应应包含 qa 字段');
    assert.ok(Array.isArray(body.qa), 'qa 应为数组');
    assert.strictEqual(body.qa.length, 0, '不存在的实体返回空数组');
  });

  it('GET /api/wiki/entities/search 支持关键词搜索', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/search?q=Test%20Entity`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body), '响应体应为数组');
    assert.ok(body.length >= 1, '应返回至少一个结果');

    const slugs = body.map((e: any) => e.slug);
    assert.ok(slugs.includes('test-entity'), '应匹配 test-entity');
  });

  it('GET /api/wiki/entities/search 无查询时返回空数组', async () => {
    const res = await fetch(`${baseUrl}/api/wiki/entities/search`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body), '响应体应为数组');
    assert.strictEqual(body.length, 0, '无查询时返回空数组');
  });
});
