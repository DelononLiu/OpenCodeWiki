/**
 * qa-router.ts — #Q 问答沉淀体系 REST API
 *
 * 所有路由挂载到 /api/qa/ 前缀下。
 */

import { Router } from 'express';
import * as store from './qa-store.js';

const router = Router();

// ── #Q CRUD ────────────────────────────────────────────────────

/** 获取下一个 #Q 编号（预览用，非必须） */
router.get('/qid/next', (_req, res) => {
  const qid = store.nextQid();
  res.json({ qid });
});

/** 按 #Q 编号获取详情（含校准答案、关联链） */
router.get('/entry/:qid', (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  if (isNaN(qid)) {
    res.status(400).json({ error: 'Invalid #Q ID' });
    return;
  }
  const entry = store.getEntryDetail(qid);
  if (!entry) {
    res.status(404).json({ error: `#Q${qid} not found` });
    return;
  }
  res.json(entry);
});

/** 获取 #Q 关联链（parent + children + related） */
router.get('/entry/:qid/related', (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  if (isNaN(qid)) {
    res.status(400).json({ error: 'Invalid #Q ID' });
    return;
  }
  const chain = store.getRelatedChain(qid);
  res.json(chain);
});

/** 列表查询 #Q 条目 */
router.get('/entries', (req, res) => {
  const repo = req.query.repo as string | undefined;
  const mode = req.query.mode as 'lightweight' | 'deep' | undefined;
  const status = req.query.status as 'active' | 'archived' | undefined;
  const sort = req.query.sort as 'latest' | 'popular' | 'visit' | undefined;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const result = store.listEntries({
    repo: repo || undefined,
    mode,
    status: status || undefined,
    sort,
    page: page && !isNaN(page) ? page : undefined,
    limit: limit && !isNaN(limit) ? limit : undefined,
  });
  res.json(result);
});

/** 创建 #Q 条目（通常由 qa-endpoint 自动调用，也支持手动创建） */
router.post('/entry', (req, res) => {
  const body = req.body || {};
  if (!body.question || !body.sessionId) {
    res.status(400).json({ error: 'Missing required fields: question, sessionId' });
    return;
  }
  try {
    const entry = store.createEntry({
      sessionId: body.sessionId,
      repo: body.repo || '',
      module: body.module || null,
      question: body.question,
      answer: body.answer ?? null,
      mode: body.mode === 'lightweight' ? 'lightweight' : 'deep',
      parentQid: body.parentQid ? parseInt(body.parentQid, 10) : null,
      relatedQids: body.relatedQids || [],
      tags: body.tags || [],
      sources: body.sources || [],
    });
    res.status(201).json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: msg });
  }
});

/** 更新 #Q 条目 */
router.patch('/entry/:qid', (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  if (isNaN(qid)) {
    res.status(400).json({ error: 'Invalid #Q ID' });
    return;
  }
  const body = req.body || {};
  const updated = store.updateEntry(qid, {
    module: body.module,
    answer: body.answer,
    status: body.status,
    relatedQids: body.relatedQids,
    tags: body.tags,
  });
  if (!updated) {
    res.status(404).json({ error: `#Q${qid} not found or not updated` });
    return;
  }
  res.json({ ok: true, qid });
});

// ── 关联管理 ───────────────────────────────────────────────────

/** 建立两个 #Q 之间的关联关系（双向） */
router.post('/entry/:qid/relate', (req, res) => {
  const sourceQid = parseInt(req.params.qid, 10);
  const targetQid = parseInt(req.body?.targetQid, 10);
  if (isNaN(sourceQid) || isNaN(targetQid) || sourceQid === targetQid) {
    res.status(400).json({ error: 'Invalid source or target #Q ID' });
    return;
  }
  const ok = store.linkEntries(sourceQid, targetQid);
  if (!ok) {
    res.status(404).json({ error: 'One or both #Q entries not found' });
    return;
  }
  res.json({ ok: true, sourceQid, targetQid });
});

// ── 轻量检索 ──────────────────────────────────────────────────

/**
 * 轻量检索端点
 * - 只调 codegraph_search，不调 LLM
 * - 同时创建 mode='lightweight' 的 #Q 记录
 * - 返回搜索结果：代码片段列表
 *
 * 由 codegraph-bridge 注册路由时代入 search 回调。
 */
export function createLightweightSearchHandler(
  search: (query: string, repo?: string) => Promise<{ sources: any[]; flows?: string }>
) {
  return async (req: any, res: any) => {
    const question = req.body?.question?.trim();
    const repoName = req.body?.repo as string | undefined;
    const sessionId = req.body?.sessionId || ('lw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

    if (!question) {
      res.status(400).json({ error: 'Missing "question" in request body' });
      return;
    }

    try {
      const { sources } = await search(question, repoName);

      // Create lightweight #Q entry
      const entry = store.createEntry({
        sessionId,
        repo: repoName || '',
        question,
        mode: 'lightweight',
        sources: sources || [],
      });

      res.json({
        qid: entry.qid,
        sessionId,
        sources: sources || [],
        entry: {
          qid: entry.qid,
          question: entry.question,
          mode: entry.mode,
          createdAt: entry.createdAt,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  };
}

// ── 标准答案 ──────────────────────────────────────────────────

/** 创建或更新校准答案 */
router.post('/entry/:qid/calibrate', (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  if (isNaN(qid)) {
    res.status(400).json({ error: 'Invalid #Q ID' });
    return;
  }
  const entry = store.getEntryByQid(qid);
  if (!entry) {
    res.status(404).json({ error: `#Q${qid} not found` });
    return;
  }

  const body = req.body || {};
  if (!body.answer) {
    res.status(400).json({ error: 'Missing required field: answer' });
    return;
  }

  const calibrated = store.upsertCalibratedAnswer({
    qaEntryId: entry.id,
    answer: body.answer,
    calibrator: body.calibrator || '',
    reason: body.reason || null,
  });
  res.json(calibrated);
});

/** 获取校准答案 */
router.get('/entry/:qid/calibrated', (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  if (isNaN(qid)) {
    res.status(400).json({ error: 'Invalid #Q ID' });
    return;
  }
  const entry = store.getEntryByQid(qid);
  if (!entry) {
    res.status(404).json({ error: `#Q${qid} not found` });
    return;
  }
  const calibrated = store.getCalibratedAnswer(entry.id);
  if (!calibrated) {
    res.status(404).json({ error: `#Q${qid} has no calibrated answer` });
    return;
  }
  res.json(calibrated);
});

/** 搜索已校准的标准答案 */
router.get('/calibrated/search', (req, res) => {
  const query = (req.query.q as string || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Missing search query' });
    return;
  }
  const results = store.searchCalibratedEntries(query, 10);
  res.json({ entries: results, total: results.length });
});

/** 获取所有校准答案列表 */
router.get('/calibrated', (_req, res) => {
  const results = store.getOrphanedCalibratedAnswers();
  res.json({ entries: results, total: results.length });
});

// ── 搜索 #Q ────────────────────────────────────────────────────

/** 按问题文本搜索 #Q */
router.get('/search', (req, res) => {
  const query = (req.query.q as string || '').trim();
  const repo = req.query.repo as string | undefined;
  if (!query) {
    res.status(400).json({ error: 'Missing search query' });
    return;
  }
  const entries = store.searchEntries(query, 10, repo);
  res.json({ entries, total: entries.length });
});

export default router;
