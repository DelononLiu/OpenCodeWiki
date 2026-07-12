/**
 * entity-service.ts — 实体服务层（基于 SQLite）
 *
 * 提供实体的 CRUD、搜索、热度排序等功能。
 * 所有数据通过 knowledge-db.ts 中的 SQLite 连接操作。
 */

import { getKnowledgeDb } from './knowledge-db.js';
import type { WikiEntity, WikiEntityFile, WikiEntityRelation } from './wiki-entity.js';

export class EntityService {
  /**
   * 返回所有实体，按搜索次数降序排列
   */
  all(): WikiEntity[] {
    const db = getKnowledgeDb();
    const rows = db.prepare('SELECT * FROM entities ORDER BY search_count DESC').all() as any[];
    return this.rowsToEntities(rows);
  }

  /**
   * 根据 slug 获取单个实体，不存在返回 null
   */
  get(slug: string): WikiEntity | null {
    const db = getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get(slug) as any;
    if (!row) return null;
    return this.rowToEntity(row);
  }

  /**
   * 保存实体（新增或更新），同时处理关联的文件和关系，并同步 FTS 索引
   *
   * 整个操作在一个事务中执行，保证原子性。
   */
  save(entity: WikiEntity): void {
    const db = getKnowledgeDb();
    db.exec('BEGIN');
    try {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT slug FROM entities WHERE slug = ?').get(entity.slug);

      if (existing) {
        db.prepare(`UPDATE entities SET name=?, definition=?, status=?, project=?,
          content=?, search_count=?, updated_at=? WHERE slug=?`)
          .run(entity.name, entity.definition, entity.status, entity.project,
            entity.content, entity.searchCount, now, entity.slug);
      } else {
        db.prepare(`INSERT INTO entities(slug,name,definition,status,project,content,search_count,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(entity.slug, entity.name, entity.definition, entity.status, entity.project,
            entity.content, entity.searchCount, now, now);
      }

      // Replace files
      db.prepare('DELETE FROM entity_files WHERE entity_slug = ?').run(entity.slug);
      const fileStmt = db.prepare('INSERT INTO entity_files(entity_slug, path, symbols) VALUES(?,?,?)');
      for (const f of entity.files || []) {
        fileStmt.run(entity.slug, f.path, JSON.stringify(f.symbols || []));
      }

      // Replace relations
      db.prepare('DELETE FROM entity_relations WHERE source_slug = ?').run(entity.slug);
      const relStmt = db.prepare('INSERT INTO entity_relations(source_slug, target_slug, relation_type, weight) VALUES(?,?,?,?)');
      for (const r of entity.relations || []) {
        relStmt.run(entity.slug, r.target, r.type, 1.0);
      }

      // Update FTS index
      db.prepare(`INSERT OR REPLACE INTO entities_fts(rowid, name, definition)
        SELECT rowid, name, definition FROM entities WHERE slug = ?`).run(entity.slug);

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * 搜索实体，优先使用 FTS5，回退到 LIKE 模糊匹配
   */
  search(query: string): WikiEntity[] {
    const db = getKnowledgeDb();
    const q = query.toLowerCase();

    // FTS5 search
    try {
      const ftsRows = db.prepare(`
        SELECT e.* FROM entities e
        JOIN entities_fts fts ON e.rowid = fts.rowid
        WHERE entities_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(q) as any[];

      if (ftsRows.length > 0) {
        return this.rowsToEntities(ftsRows);
      }
    } catch {
      // FTS5 query failed (e.g. special chars), fall through to LIKE
    }

    // Fallback to LIKE search
    const likeRows = db.prepare(
      `SELECT * FROM entities WHERE LOWER(name) LIKE ? OR LOWER(definition) LIKE ? ORDER BY search_count DESC LIMIT 20`
    ).all(`%${q}%`, `%${q}%`) as any[];
    return this.rowsToEntities(likeRows);
  }

  /**
   * 返回热度最高的实体（按搜索次数降序）
   */
  hot(limit = 10): WikiEntity[] {
    const db = getKnowledgeDb();
    const rows = db.prepare('SELECT * FROM entities ORDER BY search_count DESC LIMIT ?').all(limit) as any[];
    return this.rowsToEntities(rows);
  }

  /**
   * 增加指定实体的搜索次数
   */
  bump(slug: string): void {
    const db = getKnowledgeDb();
    db.prepare('UPDATE entities SET search_count = search_count + 1 WHERE slug = ?').run(slug);
  }

  /**
   * 删除指定实体（级联删除关联的 files、relations、qa）
   */
  delete(slug: string): void {
    const db = getKnowledgeDb();
    db.prepare('DELETE FROM entities WHERE slug = ?').run(slug);
  }

  /**
   * 将数据库行转换为 WikiEntity 对象（单行方式，用于 get 等单条查询）
   */
  private rowToEntity(row: any): WikiEntity {
    const db = getKnowledgeDb();
    const files = db.prepare('SELECT * FROM entity_files WHERE entity_slug = ?').all(row.slug) as any[];
    const rels = db.prepare('SELECT * FROM entity_relations WHERE source_slug = ?').all(row.slug) as any[];
    return {
      slug: row.slug,
      name: row.name,
      status: row.status as any,
      definition: row.definition,
      project: row.project,
      searchCount: row.search_count,
      content: row.content || '',
      files: files.map((f: any) => ({ path: f.path, symbols: JSON.parse(f.symbols || '[]') })),
      relations: rels.map((r: any) => ({ target: r.target_slug, type: r.relation_type })),
    };
  }

  /**
   * 批量将多行转换为 WikiEntity 对象（使用一次查询获取所有关联 files / relations，
   * 避免 N+1 问题）。
   */
  private rowsToEntities(rows: any[]): WikiEntity[] {
    if (rows.length === 0) return [];
    const slugs = rows.map(r => r.slug);
    const filesMap = this.batchFetchFiles(slugs);
    const relsMap = this.batchFetchRelations(slugs);
    return rows.map(r => ({
      slug: r.slug,
      name: r.name,
      status: r.status as any,
      definition: r.definition,
      project: r.project,
      searchCount: r.search_count,
      content: r.content || '',
      files: filesMap.get(r.slug) || [],
      relations: relsMap.get(r.slug) || [],
    }));
  }

  /**
   * 批量获取多个 slug 的 entity_files，返回 Map<slug, WikiEntityFile[]>
   */
  private batchFetchFiles(slugs: string[]): Map<string, WikiEntityFile[]> {
    const db = getKnowledgeDb();
    const placeholders = slugs.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM entity_files WHERE entity_slug IN (${placeholders})`).all(...slugs) as any[];
    const map = new Map<string, WikiEntityFile[]>();
    for (const slug of slugs) map.set(slug, []);
    for (const row of rows) {
      map.get(row.entity_slug)!.push({ path: row.path, symbols: JSON.parse(row.symbols || '[]') });
    }
    return map;
  }

  /**
   * 批量获取多个 slug 的 entity_relations，返回 Map<slug, WikiEntityRelation[]>
   */
  private batchFetchRelations(slugs: string[]): Map<string, WikiEntityRelation[]> {
    const db = getKnowledgeDb();
    const placeholders = slugs.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM entity_relations WHERE source_slug IN (${placeholders})`).all(...slugs) as any[];
    const map = new Map<string, WikiEntityRelation[]>();
    for (const slug of slugs) map.set(slug, []);
    for (const row of rows) {
      map.get(row.source_slug)!.push({ target: row.target_slug, type: row.relation_type });
    }
    return map;
  }
}
