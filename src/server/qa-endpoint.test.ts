/**
 * qa-endpoint.test.ts — routeQuestion 单路测试
 *
 * 测试双路路由的三个路径（direct / llm-with-suggestion / llm）
 * 以及边界分数（精确 0.85, 0.5, 无结果）。
 *
 * 使用 mock.module 拦截 unifiedSearch，同时使用真实 qa-store
 * 操作隔离的临时数据库。
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('routeQuestion', () => {
  let tmpDir: string;
  let origDataDir: string | undefined;
  let qaMod: Awaited<typeof import('./qa-store.js')>;
  let calibratedQid: number;
  let routeQuestion: (
    question: string,
  ) => Promise<{
    type: string;
    data: any;
  }>;

  // Create the mock function that will be injected into search-service
  const mockUnifiedSearch = mock.fn<() => Promise<{
    entities: { slug: string; name: string; definition: string; score: number }[];
    qa: { qid: number; question: string; score: number; isCalibrated: boolean }[];
    suggestions: { qid: number; question: string; score: number }[];
  }>>();

  before(async () => {
    // Setup temp directory for QA database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-endpoint-test-'));
    origDataDir = process.env.OPENCODEWIKI_QA_DATA_DIR;
    process.env.OPENCODEWIKI_QA_DATA_DIR = tmpDir;

    // Initialize QA store with a calibrated entry
    qaMod = await import('./qa-store.js');
    const qaDb = qaMod.getQaDb();
    qaDb.exec('PRAGMA foreign_keys=OFF');

    const entry = qaMod.createEntry({
      sessionId: 'route-test-session',
      repo: 'test-repo',
      question: 'How to optimize Node.js performance',
      mode: 'deep',
    });
    calibratedQid = entry.qid;

    qaMod.upsertCalibratedAnswer({
      qaEntryId: entry.id,
      answer: 'Use worker threads and efficient I/O with clustering.',
      calibrator: 'test',
    });

    // Setup mock for unifiedSearch BEFORE importing qa-endpoint
    // (qa-endpoint has a static import of search-service)
    mock.module('./search-service.js', {
      namedExports: {
        unifiedSearch: mockUnifiedSearch,
      },
    });

    // Import qa-endpoint (will use the mocked search-service)
    const endpointMod = await import('./qa-endpoint.js');
    routeQuestion = endpointMod.routeQuestion;
  });

  after(() => {
    if (qaMod) qaMod.closeDb();
    process.env.OPENCODEWIKI_QA_DATA_DIR = origDataDir ?? '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Direct hit (score >= 0.85) ─────────────────────────────────

  it('returns direct hit when score >= 0.85 with calibrated answer', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.9,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('How to optimize Node.js performance');

    assert.strictEqual(result.type, 'direct');
    if (result.type === 'direct') {
      assert.strictEqual(result.data.tag, 'standard');
      assert.strictEqual(result.data.qid, calibratedQid);
      assert.ok(result.data.answer.includes('worker threads'));
    }
  });

  it('returns direct hit when score exactly 0.85', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.85,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('test question');

    assert.strictEqual(result.type, 'direct');
    if (result.type === 'direct') {
      assert.strictEqual(result.data.tag, 'standard');
    }
  });

  it('falls through to llm-with-suggestion when score >= 0.85 but no calibrated answer in DB', async () => {
    // Use a qid that doesn't exist in the test DB
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: 99999,
          question: 'Some non-existent question',
          score: 0.9,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('test question');

    // Should fall through to llm-with-suggestion (score still >= 0.5)
    assert.strictEqual(result.type, 'llm-with-suggestion');
  });

  // ── Suggestion (score 0.5-0.85) ────────────────────────────────

  it('returns llm-with-suggestion when score is 0.5-0.85', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.6,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('optimize node');

    assert.strictEqual(result.type, 'llm-with-suggestion');
    if (result.type === 'llm-with-suggestion') {
      assert.strictEqual(result.data.suggestion.qid, calibratedQid);
      assert.ok(result.data.suggestion.question.includes('optimize'));
      assert.deepStrictEqual(result.data.context.entities, []);
    }
  });

  it('returns llm-with-suggestion when score exactly 0.5', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.5,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('test');

    assert.strictEqual(result.type, 'llm-with-suggestion');
  });

  // ── Pure LLM (score < 0.5, or no QA results) ───────────────────

  it('returns llm when score < 0.5', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.3,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('test');

    assert.strictEqual(result.type, 'llm');
  });

  it('returns llm when no QA results', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [],
      suggestions: [],
    }));

    const result = await routeQuestion('brand new question');

    assert.strictEqual(result.type, 'llm');
  });

  // ── Entity context ────────────────────────────────────────────

  it('passes entity context through for llm type', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [
        {
          slug: 'node-js',
          name: 'Node.js',
          definition: 'A JavaScript runtime',
          score: 0.9,
        },
      ],
      qa: [],
      suggestions: [],
    }));

    const result = await routeQuestion('Node.js');

    assert.strictEqual(result.type, 'llm');
    assert.strictEqual(result.data.context.entities.length, 1);
    assert.strictEqual(result.data.context.entities[0].slug, 'node-js');
  });

  it('passes entity context through for llm-with-suggestion type', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [
        {
          slug: 'node-js',
          name: 'Node.js',
          definition: 'A JavaScript runtime',
          score: 0.9,
        },
      ],
      qa: [
        {
          qid: calibratedQid,
          question: 'How to optimize Node.js performance',
          score: 0.6,
          isCalibrated: true,
        },
      ],
      suggestions: [],
    }));

    const result = await routeQuestion('Node.js optimize');

    assert.strictEqual(result.type, 'llm-with-suggestion');
    assert.strictEqual(result.data.context.entities.length, 1);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('handles empty question gracefully', async () => {
    mockUnifiedSearch.mock.mockImplementation(async () => ({
      entities: [],
      qa: [],
      suggestions: [],
    }));

    const result = await routeQuestion('');

    assert.strictEqual(result.type, 'llm');
  });
});
