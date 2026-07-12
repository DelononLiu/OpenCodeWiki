/**
 * search-service.ts — 统一搜索服务
 *
 * 同时查询 knowledge.db（实体）和 qa.db（QA 条目），
 * 返回结构化搜索结果（已校准 QA / 未校准建议）。
 *
 * 不暴露为独立 API，作为 QA Engine 的内部依赖。
 */

import { getKnowledgeDb } from './knowledge-db.js';
import { getQaDb } from './qa-store.js';

// ── Types ──────────────────────────────────────────────────────────

export interface SearchResultEntity {
  slug: string;
  name: string;
  definition: string;
  score: number;
}

export interface SearchResultQa {
  qid: number;
  question: string;
  score: number;
  isCalibrated: boolean;
}

export interface SearchResultSuggestion {
  qid: number;
  question: string;
  score: number;
}

export interface SearchResult {
  entities: SearchResultEntity[];
  qa: SearchResultQa[];
  suggestions: SearchResultSuggestion[];
}

// ── Unified Search ─────────────────────────────────────────────────

/**
 * 统一搜索：同时查询实体和 QA 条目。
 *
 * 保持 async 签名以支持未来扩展（如远程搜索源）。
 */
export async function unifiedSearch(query: string): Promise<SearchResult> {
  const q = query.trim();

  if (!q) {
    return { entities: [], qa: [], suggestions: [] };
  }

  const entities = searchEntities(q);
  const qaResults = searchQa(q);

  return {
    entities,
    qa: qaResults.filter((r) => r.isCalibrated),
    suggestions: qaResults.filter((r) => !r.isCalibrated),
  };
}

// ── Internal: Entity Search ───────────────────────────────────────

function searchEntities(query: string): SearchResultEntity[] {
  const db = getKnowledgeDb();
  const q = query.toLowerCase();

  // 优先使用 FTS5 全文搜索
  try {
    const rows = db
      .prepare(
        `SELECT e.slug, e.name, e.definition, fts.rank
         FROM entities e
         JOIN entities_fts fts ON e.rowid = fts.rowid
         WHERE entities_fts MATCH ?
         ORDER BY rank
         LIMIT 5`,
      )
      .all(q) as any[];

    if (rows.length > 0) {
      return rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        definition: r.definition,
        score: 1.0 / (1.0 + Math.abs(r.rank)),
      }));
    }
  } catch {
    // FTS5 查询失败（如特殊字符），回退到 LIKE
  }

  // LIKE 模糊匹配回退
  try {
    const likeRows = db
      .prepare(
        `SELECT slug, name, definition
         FROM entities
         WHERE LOWER(name) LIKE ? OR LOWER(definition) LIKE ?
         ORDER BY search_count DESC
         LIMIT 5`,
      )
      .all(`%${q}%`, `%${q}%`) as any[];

    return likeRows.map((r, i) => ({
      slug: r.slug,
      name: r.name,
      definition: r.definition,
      score: Math.max(0.1, 0.5 - i * 0.1),
    }));
  } catch {
    return [];
  }
}

// ── Internal: QA Search ────────────────────────────────────────────

function searchQa(query: string): SearchResultQa[] {
  try {
    const db = getQaDb();
    const q = query.toLowerCase();

    // 使用 LIKE 模糊查询（qa_entries_fts 是 external content FTS5 表，
    // 但其触发器和索引主要用于内部；LIKE 更可靠且易于控制）
    const rows = db
      .prepare(
        `SELECT qa.qid, qa.question,
                (SELECT COUNT(*)
                 FROM calibrated_answers ca
                 WHERE ca.qa_entry_id = qa.id) AS calibrated_count
         FROM qa_entries qa
         WHERE qa.question LIKE ?
         ORDER BY qa.visit_count DESC
         LIMIT 5`,
      )
      .all(`%${q}%`) as any[];

    return rows.map((r, i) => ({
      qid: r.qid,
      question: r.question,
      score: r.calibrated_count > 0
        ? Math.max(0.5, 1.0 - i * 0.1)
        : Math.max(0.2, 0.6 - i * 0.08),
      isCalibrated: r.calibrated_count > 0,
    }));
  } catch {
    // qa.db 尚未初始化或不可用
    return [];
  }
}
