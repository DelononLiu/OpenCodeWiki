/**
 * migrate-entities.ts — JSON 到 knowledge.db 的实体迁移脚本
 *
 * 将 ~/.opencodewiki/entities/ 下的实体 JSON 文件迁移到 SQLite 数据库。
 * 旧 JSON 的 status 值会被映射：
 *   initial    → draft
 *   calibrated → reviewed
 *   filled     → published
 *
 * 使用方式:
 *   npx tsx src/server/migrate-entities.ts       # CLI 执行
 *   import { migrateEntitiesFromJson } from '...' # 编程调用
 */

import { getKnowledgeDb } from './knowledge-db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const ENTITIES_DIR = path.join(os.homedir(), '.opencodewiki', 'entities');

/**
 * 旧 JSON status 到新 DB status 的映射
 */
const OLD_TO_NEW_STATUS: Record<string, string> = {
  initial: 'draft',
  calibrated: 'reviewed',
  filled: 'published',
};

export interface MigrateResult {
  migrated: number;
  errors: number;
}

/**
 * 将 ~/.opencodewiki/entities/ 下的 JSON 实体迁移到 knowledge.db。
 *
 * 已存在于数据库中的实体（由 slug 标识）会被跳过（INSERT OR IGNORE）。
 * 非法 JSON 文件会增加 errors 计数并跳过。
 * 实体目录不存在时静默返回 { migrated: 0, errors: 0 }。
 */
export function migrateEntitiesFromJson(): MigrateResult {
  const db = getKnowledgeDb();
  let migrated = 0;
  let errors = 0;

  let files: string[];
  try {
    files = fs.readdirSync(ENTITIES_DIR);
  } catch {
    // entities 目录不存在，无需迁移
    return { migrated: 0, errors: 0 };
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue;

    try {
      const raw = fs.readFileSync(path.join(ENTITIES_DIR, f), 'utf-8');
      const data = JSON.parse(raw);
      const slug = data.slug || f.replace('.json', '');

      // 映射旧 status → 新 status
      const newStatus = OLD_TO_NEW_STATUS[data.status] || 'draft';

      const now = new Date().toISOString();
      const insertResult = db.prepare(
        `INSERT OR IGNORE INTO entities(slug, name, definition, status, project, content, search_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        slug,
        data.name || slug,
        data.definition || '',
        newStatus,
        data.project || '',
        data.content || '',
        data.searchCount || 0,
        data.createdAt || now,
        now,
      );

      // INSERT OR IGNORE 未插入新行，说明实体已存在，跳过
      if (insertResult.changes === 0) continue;

      // 迁移关联文件（逐条处理，跳过失败项避免中断整个实体迁移）
      if (Array.isArray(data.files)) {
        const fileStmt = db.prepare(
          'INSERT OR IGNORE INTO entity_files(entity_slug, path, symbols) VALUES (?, ?, ?)',
        );
        for (const file of data.files) {
          try {
            fileStmt.run(slug, file.path, JSON.stringify(file.symbols || []));
          } catch {
            // 跳过单个文件失败（例如 FK 约束暂时不满足）
          }
        }
      }

      // 迁移关联关系（逐条处理，跳过失败项）
      if (Array.isArray(data.relations)) {
        const relStmt = db.prepare(
          'INSERT OR IGNORE INTO entity_relations(source_slug, target_slug, relation_type, weight) VALUES (?, ?, ?, ?)',
        );
        for (const rel of data.relations) {
          try {
            relStmt.run(slug, rel.target, rel.type || 'related', 1.0);
          } catch {
            // 跳过单个关系失败（例如目标实体尚未迁移）
          }
        }
      }

      // 更新 FTS 索引
      db.prepare(
        `INSERT OR REPLACE INTO entities_fts(rowid, name, definition)
         SELECT rowid, name, definition FROM entities WHERE slug = ?`,
      ).run(slug);

      migrated++;
    } catch (e) {
      errors++;
      console.error(`[migrate] failed to migrate ${f}:`, e);
    }
  }

  return { migrated, errors };
}

// CLI 入口
const isMainScript =
  process.argv[1]?.endsWith('/migrate-entities.ts') ||
  process.argv[1]?.endsWith('/migrate-entities.js');

if (isMainScript) {
  const result = migrateEntitiesFromJson();
  console.log(`Migrated: ${result.migrated}, errors: ${result.errors}`);
}
