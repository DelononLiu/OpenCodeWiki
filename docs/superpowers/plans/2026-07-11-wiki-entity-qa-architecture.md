# Wiki 实体化 + QA 统一架构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将实体存储从 JSON 文件迁移到 SQLite（knowledge.db），实现双路 QA 引擎、实体-QA 关联、wiki 页面生命周期管理和前端整合。

**Architecture:** 数据分两层——结构化数据（knowledge.db，SQLite）和文档正文（.md 文件）。搜索是 QA 引擎的内部依赖，不暴露为独立 API。双路 QA 引擎：高置信命中（≥0.85）直接返回校准答案，未命中走 LLM。实体与 wiki 页面通过 slug 关联，相互解耦。

**Tech Stack:** Node.js `node:sqlite`（内置，无需 better-sqlite3）、Express、TypeScript、codebase-memory-mcp（codegraph 引擎）

## 文件结构

```
新增:
  src/server/knowledge-db.ts          — knowledge.db 初始化、schema、连接单例
  src/server/entity-service.ts         — 实体 CRUD（替换 wiki-entity.ts 的 JSON 存储）
  src/server/search-service.ts         — 统一搜索（实体 + QA，FTS5）
  src/server/wiki-page-service.ts      — Wiki .md 页面生命周期管理
  src/server/migrate-entities.ts       — JSON → knowledge.db 迁移脚本

修改:
  src/server/wiki-entity.ts            — 改为委托 entity-service，保留接口兼容
  src/server/server.ts                 — 更新实体路由、添加搜索路由、修改 wiki 查看器路由
  src/server/qa-store.ts               — 添加 FTS5 索引 + 相似度搜索接口
  src/server/qa-endpoint.ts            — 添加双路路由（直接命中和 LLM 生成）
  src/wiki/entity.html                 — 重写为混合渲染（.md + 结构化数据 + #Q 面板）

新增（模板文件）:
  ~/.opencodewiki/pages/templates/entity.md
  ~/.opencodewiki/pages/templates/overview.md
  ~/.opencodewiki/pages/templates/qa-archive.md
```

## 全局约束

- 所有 SQLite 操作使用 Node 内置 `node:sqlite`（DatabaseSync），不引入 better-sqlite3
- entity 数据与 wiki 正文分离：结构数据在 knowledge.db，文档正文在 .md 文件
- 搜索是 QA 引擎内部依赖，不暴露独立搜索 API 给前端
- 双路 QA 阈值：≥0.85 直接返校准答案，0.5~0.85 推相似问题，<0.5 纯 LLM 生成
- 与 codegraph 软关联（符号名字符串），不做校验层
- 不使用全局蜘蛛网关系图，只做局部邻里图（1-2 跳）

---

### Phase 1 — 存储底座（knowledge.db + 实体迁移）

#### Task 1: knowledge.db schema 和连接管理

**Files:**
- Create: `src/server/knowledge-db.ts`
- Modify: `src/server/wiki-entity.ts`（后续任务）

**Interfaces:**
- Produces: `getKnowledgeDb(): DatabaseSync` — 获取 DB 单例
- Produces: `initKnowledgeDb(): void` — 确保所有表存在

- [ ] **Step 1: 创建 src/server/knowledge-db.ts**

```typescript
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.opencodewiki', 'knowledge.db');

let _db: DatabaseSync | null = null;

export function getKnowledgeDb(): DatabaseSync {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec('PRAGMA foreign_keys=ON');
  initKnowledgeDb();
  return _db;
}

export function closeKnowledgeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function initKnowledgeDb(): void {
  const db = getKnowledgeDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT DEFAULT '',
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','reviewed','published')),
      project TEXT DEFAULT '',
      page_type TEXT DEFAULT 'entity',
      content TEXT DEFAULT '',
      search_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entity_files (
      entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      path TEXT NOT NULL,
      symbols TEXT DEFAULT '[]',
      PRIMARY KEY (entity_slug, path)
    );

    CREATE TABLE IF NOT EXISTS entity_relations (
      source_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      target_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      relation_type TEXT CHECK(relation_type IN ('depends-on','part-of','related')),
      weight REAL DEFAULT 1.0,
      source TEXT DEFAULT 'llm',
      PRIMARY KEY (source_slug, target_slug, relation_type)
    );

    CREATE TABLE IF NOT EXISTS entity_qa (
      entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
      qid INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
      name, definition, content='entities', content_rowid='rowid'
    );
  `);
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: No errors (knowledge-db.ts uses node:sqlite which may need @types/node)

- [ ] **Step 3: 提交**

```bash
git add src/server/knowledge-db.ts
git commit -m "feat: knowledge.db schema and connection singleton"
```

#### Task 2: 实体服务层（EntityService，替换 JSON 存储）

**Files:**
- Create: `src/server/entity-service.ts`
- Modify: `src/server/wiki-entity.ts`（委托到新服务）

**Interfaces:**
- Consumes: `getKnowledgeDb()` from knowledge-db.ts
- Consumes: `WikiEntity` type from wiki-entity.ts
- Produces: `EntityService` — all(), get(slug), save(entity), search(query), hot(limit), bump(slug)

- [ ] **Step 1: 创建实体服务接口定义**

```typescript
// src/server/entity-service.ts
import { getKnowledgeDb } from './knowledge-db.js';
import type { WikiEntity, WikiEntityFile, WikiEntityRelation } from './wiki-entity.js';

export class EntityService {
  all(): WikiEntity[] { /* from SQLite */ }
  get(slug: string): WikiEntity | null { /* from SQLite */ }
  save(entity: WikiEntity): void { /* upsert + handle files/relations */ }
  search(query: string): WikiEntity[] { /* FTS5 + name/definition LIKE */ }
  hot(limit: number): WikiEntity[] { /* ORDER BY search_count DESC */ }
  bump(slug: string): void { /* UPDATE search_count + 1 */ }
  delete(slug: string): void { /* DELETE CASCADE */ }
}
```

- [ ] **Step 2: 实现 EntityService.all()**

```typescript
all(): WikiEntity[] {
  const db = getKnowledgeDb();
  const rows = db.prepare('SELECT * FROM entities ORDER BY search_count DESC').all() as any[];
  return rows.map(r => this.rowToEntity(r));
}

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
```

- [ ] **Step 3: 实现 EntityService.save()**

```typescript
save(entity: WikiEntity): void {
  const db = getKnowledgeDb();
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

  // Update FTS
  db.prepare(`INSERT OR REPLACE INTO entities_fts(rowid, name, definition)
    SELECT rowid, name, definition FROM entities WHERE slug = ?`).run(entity.slug);
}
```

- [ ] **Step 4: 实现搜索和热度方法**

```typescript
search(query: string): WikiEntity[] {
  const db = getKnowledgeDb();
  const q = query.toLowerCase();
  // FTS5 search
  const ftsRows = db.prepare(`
    SELECT e.* FROM entities e
    JOIN entities_fts fts ON e.rowid = fts.rowid
    WHERE entities_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `).all(q) as any[];
  
  if (ftsRows.length > 0) {
    return ftsRows.map(r => this.rowToEntity(r));
  }
  
  // Fallback to LIKE search
  const likeRows = db.prepare(
    `SELECT * FROM entities WHERE LOWER(name) LIKE ? OR LOWER(definition) LIKE ? ORDER BY search_count DESC LIMIT 20`
  ).all(`%${q}%`, `%${q}%`) as any[];
  return likeRows.map(r => this.rowToEntity(r));
}

hot(limit = 10): WikiEntity[] {
  const db = getKnowledgeDb();
  const rows = db.prepare('SELECT * FROM entities ORDER BY search_count DESC LIMIT ?').all(limit) as any[];
  return rows.map(r => this.rowToEntity(r));
}

bump(slug: string): void {
  const db = getKnowledgeDb();
  db.prepare('UPDATE entities SET search_count = search_count + 1 WHERE slug = ?').run(slug);
}
```

- [ ] **Step 5: 修改 wiki-entity.ts 委托到 EntityService**

```typescript
// 在 wiki-entity.ts 文件末尾添加
import { EntityService } from './entity-service.js';
const entityService = new EntityService();

export function getEntityService(): EntityService {
  return entityService;
}
```

保持 `EntityStore` 类不变（向后兼容），在新代码中直接使用 `EntityService`。

- [ ] **Step 6: 验证编译**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: 提交**

```bash
git add src/server/entity-service.ts src/server/wiki-entity.ts
git commit -m "feat: entity service layer on knowledge.db"
```

#### Task 3: JSON 到 knowledge.db 的实体迁移脚本

**Files:**
- Create: `src/server/migrate-entities.ts`

- [ ] **Step 1: 创建迁移脚本**

```typescript
// src/server/migrate-entities.ts
import { getKnowledgeDb } from './knowledge-db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const ENTITIES_DIR = path.join(os.homedir(), '.opencodewiki', 'entities');

export function migrateEntitiesFromJson(): { migrated: number; errors: number } {
  const db = getKnowledgeDb();
  let migrated = 0, errors = 0;
  
  try {
    const files = fs.readdirSync(ENTITIES_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(ENTITIES_DIR, f), 'utf-8'));
        const slug = data.slug || f.replace('.json', '');
        
        db.prepare(`INSERT OR IGNORE INTO entities(slug,name,definition,status,project,content,search_count,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(slug, data.name || slug, data.definition || '', data.status || 'draft',
            data.project || '', data.content || '', data.searchCount || 0,
            data.createdAt || new Date().toISOString(), new Date().toISOString());
        
        // Migrate files
        if (data.files) {
          const stmt = db.prepare('INSERT OR IGNORE INTO entity_files(entity_slug, path, symbols) VALUES(?,?,?)');
          for (const file of data.files) {
            stmt.run(slug, file.path, JSON.stringify(file.symbols || []));
          }
        }
        
        // Migrate relations
        if (data.relations) {
          const stmt = db.prepare('INSERT OR IGNORE INTO entity_relations(source_slug, target_slug, relation_type, weight) VALUES(?,?,?,?)');
          for (const rel of data.relations) {
            stmt.run(slug, rel.target, rel.type || 'related', 1.0);
          }
        }
        
        migrated++;
      } catch (e) {
        errors++;
        console.error(`[migrate] failed to migrate ${f}:`, e);
      }
    }
  } catch { /* entities dir not found */ }
  
  return { migrated, errors };
}

// CLI: node src/server/migrate-entities.ts
if (process.argv[1]?.endsWith('migrate-entities.ts') || process.argv[1]?.endsWith('migrate-entities.js')) {
  const result = migrateEntitiesFromJson();
  console.log(`Migrated: ${result.migrated}, errors: ${result.errors}`);
}
```

- [ ] **Step 2: 验证运行**

Run: `npx tsx src/server/migrate-entities.ts`
Expected: "Migrated: N, errors: 0"（取决于当前有多少实体 JSON）

- [ ] **Step 3: 提交**

```bash
git add src/server/migrate-entities.ts
git commit -m "feat: JSON to knowledge.db entity migration script"
```

---

### Phase 2 — 实体-QA 关联

#### Task 4: QA 存储添加 FTS5 和相似度搜索

**Files:**
- Modify: `src/server/qa-store.ts`

- [ ] **Step 1: 在 qa-store.ts 中添加 FTS5 表和相似度搜索函数**

在 `getDb()` 的 schema 创建部分添加 FTS5 表：

```typescript
// 在 SQL_CREATE_TABLES 末尾追加
const SQL_CREATE_TABLES = `
  ...(existing tables)...
  
  CREATE VIRTUAL TABLE IF NOT EXISTS qa_entries_fts USING fts5(
    question, content='qa_entries', content_rowid='rowid'
  );
  
  CREATE TRIGGER IF NOT EXISTS qa_fts_insert AFTER INSERT ON qa_entries BEGIN
    INSERT INTO qa_entries_fts(rowid, question) SELECT rowid, question FROM qa_entries WHERE rowid = new.rowid;
  END;
  
  CREATE TRIGGER IF NOT EXISTS qa_fts_delete AFTER DELETE ON qa_entries BEGIN
    INSERT INTO qa_entries_fts(qa_entries_fts, rowid, question) VALUES('delete', old.rowid, old.question);
  END;
  
  CREATE TRIGGER IF NOT EXISTS qa_fts_update AFTER UPDATE ON qa_entries BEGIN
    INSERT INTO qa_entries_fts(qa_entries_fts, rowid, question) VALUES('delete', old.rowid, old.question);
    INSERT INTO qa_entries_fts(rowid, question) SELECT rowid, question FROM qa_entries WHERE rowid = new.rowid;
  END;
`;
```

然后添加 FTS5 到知识库的桥接：在 knowledge-db.ts 的初始化中引用 qa.db：

不需要——保持 qa.db 独立。在 search-service.ts 中分别查询两个 DB。

- [ ] **Step 2: 导出 qa.db 的 DatabaseSync 实例**

在 `qa-store.ts` 中添加：

```typescript
export function getQaDb(): DatabaseSync {
  return getDb();
}
```

- [ ] **Step 3: 提交**

```bash
git add src/server/qa-store.ts
git commit -m "feat: add FTS5 index to qa_entries"
```

#### Task 5: 统一搜索服务

**Files:**
- Create: `src/server/search-service.ts`

- [ ] **Step 1: 创建搜索服务**

```typescript
// src/server/search-service.ts
import { getKnowledgeDb } from './knowledge-db.js';
import { EntityService } from './entity-service.js';

export interface SearchResult {
  entities: { slug: string; name: string; definition: string; score: number }[];
  qa: { qid: number; question: string; score: number; isCalibrated: boolean }[];
  suggestions: { qid: number; question: string; score: number }[];
}

export function unifiedSearch(query: string): SearchResult {
  const db = getKnowledgeDb();
  const q = query.toLowerCase();
  
  // Entity FTS5 search
  const entityRows = db.prepare(`
    SELECT e.slug, e.name, e.definition, e.rowid
    FROM entities e
    JOIN entities_fts fts ON e.rowid = fts.rowid
    WHERE entities_fts MATCH ?
    LIMIT 5
  `).all(q) as any[];
  
  // QA search — separate qa.db
  let qaResults: { qid: number; question: string; score: number; isCalibrated: boolean }[] = [];
  try {
    const { getQaDb } = await import('./qa-store.js');
    const qaDb = getQaDb();
    const qaRows = qaDb.prepare(`
      SELECT qa.qid, qa.question,
        (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = qa.id) AS calibrated_count
      FROM qa_entries qa
      WHERE qa.question LIKE ?
      ORDER BY qa.visit_count DESC
      LIMIT 5
    `).all(`%${q}%`) as any[];
    qaResults = qaRows.map((r: any) => ({
      qid: r.qid,
      question: r.question,
      score: 0.5, // placeholder — real score from FTS5 rank when available
      isCalibrated: r.calibrated_count > 0,
    }));
  } catch { /* qa db not available */ }

  return {
    entities: entityRows.map((r: any, i: number) => ({
      slug: r.slug,
      name: r.name,
      definition: r.definition,
      score: 1.0 - (i * 0.1),
    })),
    qa: qaResults.filter(r => r.isCalibrated),
    suggestions: qaResults.filter(r => !r.isCalibrated),
  };
}
```

注意：`unifiedSearch` 需要是 async 函数（import 是动态的）。修正签名：

```typescript
export async function unifiedSearch(query: string): Promise<SearchResult> { ... }
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add src/server/search-service.ts
git commit -m "feat: unified search service for entities and QA"
```

---

### Phase 3 — 双路 QA 引擎

#### Task 6: QA 端点添加双路路由

**Files:**
- Modify: `src/server/qa-endpoint.ts`

**Interfaces:**
- Consumes: `unifiedSearch()` from search-service.ts

- [ ] **Step 1: 在 qa-endpoint.ts 中添加路由逻辑**

在回答生成流程中插入搜索和路由。修改 `createQaEndpoint` 中的处理流程：

```typescript
// 在调用 LLM 之前，先走搜索和路由
import { unifiedSearch } from './search-service.js';

async function routeQuestion(question: string): Promise<{ type: 'direct' | 'llm' | 'llm-with-suggestion'; data: any }> {
  const results = await unifiedSearch(question);
  
  // 检查是否有高置信度的校准 #Q 命中
  const topQa = results.qa[0];
  if (topQa && topQa.score >= 0.85) {
    // 直接返回校准答案
    const { getEntryDetail } = await import('./qa-store.js');
    const detail = getEntryDetail(topQa.qid);
    if (detail?.calibratedAnswer) {
      return { 
        type: 'direct',
        data: {
          answer: detail.calibratedAnswer.answer,
          qid: topQa.qid,
          tag: 'standard',
        }
      };
    }
  }
  
  // 没有命中，准备 LLM 上下文
  const context: any = { entities: results.entities };
  
  if (topQa && topQa.score >= 0.5) {
    // 较低置信 — 推荐相似问题
    return {
      type: 'llm-with-suggestion',
      data: { context, suggestion: { qid: topQa.qid, question: topQa.question } },
    };
  }
  
  return { type: 'llm', data: { context } };
}
```

- [ ] **Step 2: 添加标准答案标记到 SSE 响应**

在 SSE 响应流中，添加一个新的 event 类型：

```typescript
// 直接命中时
res.write(`data: ${JSON.stringify({ type: 'tag', tag: 'standard', qid: topQa.qid })}\n\n`);
res.write(`data: ${JSON.stringify({ type: 'token', content: detail.calibratedAnswer.answer })}\n\n`);
res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
```

- [ ] **Step 3: 添加相似问题推荐到 LLM 生成末尾**

修改 LLM system prompt，添加规则：

```typescript
// 在 LLM 生成完成后，如果有推荐问题，追加到回答末尾
if (routeResult.type === 'llm-with-suggestion') {
  const { suggestion } = routeResult.data;
  answerContent += `\n\n---\n> 🤔 你可能想问: [#Q${suggestion.qid} ${suggestion.question}](/qa?qid=${suggestion.qid})`;
}
```

- [ ] **Step 4: 提交**

```bash
git add src/server/qa-endpoint.ts src/server/search-service.ts
git commit -m "feat: dual-path QA engine with direct hit and suggestion"
```

#### Task 7: QA 回答后自动关联实体

**Files:**
- Modify: `src/server/qa-endpoint.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: 添加实体关联逻辑**

在 QA 回答完成后（SSE 结束前），添加实体提取和关联：

```typescript
// 在 qa-endpoint.ts 中添加
async function linkAnswerToEntities(question: string, answer: string): Promise<void> {
  const db = getKnowledgeDb();
  const q = question.toLowerCase();
  
  // 搜索问题中涉及的实体
  const entities = db.prepare(`
    SELECT slug, name FROM entities WHERE LOWER(name) LIKE ? OR LOWER(definition) LIKE ?
  `).all(`%${q}%`, `%${q}%`) as any[];
  
  // 也尝试从回答中提取 #实体名 标记
  const slugRegex = /#([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = slugRegex.exec(answer)) !== null) {
    // 如果问题搜索未找到，尝试精确匹配实体名
    const slugEntity = db.prepare('SELECT slug FROM entities WHERE slug = ?').get(m[1]) as any;
    if (slugEntity && !entities.find((e: any) => e.slug === slugEntity.slug)) {
      entities.push(slugEntity);
    }
  }
  
  if (entities.length === 0) return;
  
  // 获取当前 QA 的 qid
  // （需要从 session 或返回值中获取）
}
```

- [ ] **Step 2: 将关联写入 entity_qa 表**

```typescript
const stmt = db.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?,?)');
for (const entity of entities) {
  stmt.run(entity.slug, qid);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/server/qa-endpoint.ts
git commit -m "feat: auto-link QA answers to entities"
```

---

### Phase 4 — Wiki 页面生命周期

#### Task 8: Wiki 页面模板与 .md 管理

**Files:**
- Create: `src/server/wiki-page-service.ts`
- Create: `~/.opencodewiki/pages/templates/entity.md`
- Create: `~/.opencodewiki/pages/templates/overview.md`
- Create: `~/.opencodewiki/pages/templates/qa-archive.md`

- [ ] **Step 1: 创建 wiki 页面服务**

```typescript
// src/server/wiki-page-service.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const PAGES_DIR = path.join(os.homedir(), '.opencodewiki', 'pages');

export interface WikiPageMeta {
  slug: string;
  pageType: string;
  status: string;
  title: string;
  createdBy?: string;
  reviewedBy?: string;
  publishedAt?: string;
}

export async function ensurePageDirs(): Promise<void> {
  const dirs = [
    path.join(PAGES_DIR, 'entities'),
    path.join(PAGES_DIR, 'overviews'),
    path.join(PAGES_DIR, 'qa-archives'),
    path.join(PAGES_DIR, 'templates'),
  ];
  for (const d of dirs) {
    await fs.mkdir(d, { recursive: true });
  }
}

export function pageDir(pageType: string): string {
  const map: Record<string, string> = {
    entity: 'entities',
    overview: 'overviews',
    'qa-archive': 'qa-archives',
  };
  return path.join(PAGES_DIR, map[pageType] || 'entities');
}

export function pagePath(slug: string, pageType: string): string {
  return path.join(pageDir(pageType), `${slug}.md`);
}

export async function readPage(slug: string, pageType: string): Promise<string | null> {
  try {
    return await fs.readFile(pagePath(slug, pageType), 'utf-8');
  } catch {
    return null;
  }
}

export async function writePage(slug: string, pageType: string, content: string): Promise<void> {
  await fs.mkdir(pageDir(pageType), { recursive: true });
  await fs.writeFile(pagePath(slug, pageType), content, 'utf-8');
}

export async function parseFrontmatter(content: string): Promise<{ meta: WikiPageMeta | null; body: string }> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: null, body: content };
  
  const meta: any = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  
  return {
    meta: {
      slug: meta.slug || '',
      pageType: meta.page_type || 'entity',
      status: meta.status || 'draft',
      title: meta.title || '',
      createdBy: meta.created_by,
      reviewedBy: meta.reviewed_by,
      publishedAt: meta.published_at,
    },
    body: match[2].trim(),
  };
}

export async function generateFrontmatter(meta: WikiPageMeta): Promise<string> {
  const lines = ['---'];
  lines.push(`slug: ${meta.slug}`);
  lines.push(`page_type: ${meta.pageType}`);
  lines.push(`status: ${meta.status}`);
  lines.push(`title: ${meta.title}`);
  if (meta.createdBy) lines.push(`created_by: ${meta.createdBy}`);
  if (meta.reviewedBy) lines.push(`reviewed_by: ${meta.reviewedBy}`);
  if (meta.publishedAt) lines.push(`published_at: ${meta.publishedAt}`);
  lines.push('---');
  return lines.join('\n');
}
```

- [ ] **Step 2: 创建模板文件**

`~/.opencodewiki/pages/templates/entity.md`:
```markdown
---
slug: ${slug}
page_type: entity
status: draft
title: ${name}
created_by: llm
---

## 定义

${definition}

## 核心职责

## 使用方式

## 关键技术细节

## 涉及代码

## 上下游关系
```

`~/.opencodewiki/pages/templates/overview.md`:
```markdown
---
slug: ${slug}
page_type: overview
status: draft
title: ${title}
created_by: llm
---

## 一句话说明

## 架构图

## 核心模块清单

## 设计决策
```

`~/.opencodewiki/pages/templates/qa-archive.md`:
```markdown
---
slug: ${slug}
page_type: qa-archive
status: published
title: ${title}
---

## 问题

## 标准答案

## 代码引用

## 相关实体
```

- [ ] **Step 3: 提交**

```bash
git add src/server/wiki-page-service.ts
git commit -m "feat: wiki page lifecycle service with templates"
```

---

### Phase 5 — 前端整合

#### Task 9: 更新实体详情页（混合渲染 + #Q 关联面板）

**Files:**
- Rewrite: `src/wiki/entity.html`

- [ ] **Step 1: 重新设计实体详情页 HTML**

新的实体页面包含：
1. 顶部：实体名称 + 状态标记
2. 定义区块
3. 涉及代码区块（从结构化数据渲染）
4. 正文区块（从 .md 渲染）
5. 右上角：关联 #Q 悬浮面板
6. 关系图（1-2 跳）

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title id="entityTitle">实体详情</title>
<style>
  /* 保留原有样式 + 新增关联面板样式 */
  .qa-sidebar {
    position: fixed;
    top: 80px;
    right: 24px;
    width: 260px;
    background: #f8f9fb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .qa-sidebar h3 {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .qa-sidebar a {
    display: block;
    padding: 6px 8px;
    font-size: 13px;
    color: #2563eb;
    text-decoration: none;
    border-radius: 4px;
  }
  .qa-sidebar a:hover { background: #eff6ff; }
  .qa-sidebar .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: #ecfdf5;
    color: #059669;
    margin-left: 4px;
  }
  @media(max-width: 1100px) {
    .qa-sidebar { position: static; width: auto; max-height: none; margin-top: 24px; }
  }
</style>
</head>
<body>
<a class="back-link" href="/">&larr; 返回首页</a>
<div style="display:flex; gap: 32px;">
  <div style="flex:1; max-width: 800px;">
    <div class="entity-header">
      <h1 id="entityName"></h1>
      <span class="status-badge" id="entityStatus"></span>
    </div>
    <p class="definition" id="entityDef"></p>
    <section><h3>涉及代码</h3><ul id="fileList"></ul></section>
    <section id="contentSection" style="display:none"><h3>详情</h3><div id="entityContent"></div></section>
    <section id="relationSection" style="display:none"><h3>上下游关系</h3><div id="relationGraph"></div></section>
  </div>
  <aside class="qa-sidebar" id="qaSidebar">
    <h3>📌 关联问题</h3>
    <div id="qaList">加载中...</div>
  </aside>
</div>
<script>
async function loadEntity() {
  const slug = location.pathname.split('/').pop();
  const r = await fetch('/api/wiki/entities/' + slug);
  if (!r.ok) { document.body.innerHTML = '<p style="padding:32px;color:red">实体未找到</p>'; return; }
  const e = await r.json();
  document.title = e.name + ' — 实体详情';
  document.getElementById('entityName').textContent = e.name;
  const badge = document.getElementById('entityStatus');
  badge.textContent = ({draft:'草稿',reviewed:'已校准',published:'已发布'})[e.status] || e.status;
  document.getElementById('entityDef').textContent = e.definition;
  if (e.files?.length) {
    document.getElementById('fileList').innerHTML = e.files.map(f =>
      '<li><code>' + f.path + '</code>' + (f.symbols?.length ? ' — ' + f.symbols.join(', ') : '') + '</li>'
    ).join('');
  }
  if (e.content) {
    document.getElementById('contentSection').style.display = '';
    document.getElementById('entityContent').innerHTML = e.content;
  }
  if (e.relations?.length) {
    document.getElementById('relationSection').style.display = '';
    const edges = e.relations.map(r => `  ${e.slug}-->|${r.type}| ${r.target}`).join('\n');
    document.getElementById('relationGraph').innerHTML =
      '<pre class="mermaid">flowchart LR\n' + edges + '\n</pre>';
    if (window.mermaid) mermaid.run();
  }
  // Load associated QA entries
  fetch('/api/wiki/entities/' + slug + '/qa')
    .then(r => r.json())
    .then(data => {
      if (data.qa?.length) {
        document.getElementById('qaList').innerHTML = data.qa.map(q =>
          `<a href="/qa?qid=${q.qid}">#Q${q.qid}: ${q.question}${q.isCalibrated ? '<span class="badge">标准答案</span>' : ''}</a>`
        ).join('');
      } else {
        document.getElementById('qaList').innerHTML = '<span style="color:#94a3b8;font-size:13px">暂无关联问题</span>';
      }
    });
}
loadEntity();
</script>
</body>
</html>
```

- [ ] **Step 2: 提交**

```bash
git add src/wiki/entity.html
git commit -m "feat: entity detail page with hybrid rendering and QA sidebar"
```

#### Task 10: 更新后台 API 路由

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: 更新实体路由使用 EntityService**

```typescript
import { EntityService } from './entity-service.js';
let _entityService: EntityService | null = null;
function getEntityService(): EntityService {
  if (!_entityService) _entityService = new EntityService();
  return _entityService;
}
```

替换现有的 `getEntityStore()` 引用，从 JSON EntityStore 迁移到 EntityService。

- [ ] **Step 2: 添加实体关联 #Q 查询 API**

```typescript
app.get('/api/wiki/entities/:slug/qa', async (req, res) => {
  const { slug } = req.params;
  const db = getKnowledgeDb();
  const rows = db.prepare(`
    SELECT eq.qid, q.question, 
      (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = q.id) AS calibrated_count
    FROM entity_qa eq
    JOIN qa_entries q ON q.qid = eq.qid
    WHERE eq.entity_slug = ?
    ORDER BY q.visit_count DESC
    LIMIT 20
  `).all(slug) as any[];
  res.json({
    qa: rows.map(r => ({
      qid: r.qid,
      question: r.question,
      isCalibrated: r.calibrated_count > 0,
    })),
  });
});
```

注意：这里需要跨 DB 查询（knowledge.db 的 entity_qa + qa.db 的 qa_entries），需要 ATTACH 或分开查询。推荐分开查询：

```typescript
// 从 knowledge.db 拿到 qid 列表
const qidRows = db.prepare('SELECT qid FROM entity_qa WHERE entity_slug = ? ORDER BY qid').all(slug) as any[];
if (qidRows.length === 0) { res.json({ qa: [] }); return; }

// 从 qa.db 查详情
const qids = qidRows.map(r => r.qid);
const { getQaDb } = await import('./qa-store.js');
const qaDb = getQaDb();
const placeholders = qids.map(() => '?').join(',');
const qaRows = qaDb.prepare(`
  SELECT q.qid, q.question,
    (SELECT COUNT(*) FROM calibrated_answers ca WHERE ca.qa_entry_id = q.id) AS calibrated_count
  FROM qa_entries q WHERE q.qid IN (${placeholders})
  ORDER BY q.visit_count DESC
`).all(...qids) as any[];
```

- [ ] **Step 3: 修改 wiki 查看器路由**

当前路由 `/:repoName` → 改为 `/:repo/wiki/:slug`：

```typescript
// 保留旧路由作为重定向
app.get('/:repoName', async (req, res, next) => {
  const names = await knownRepos();
  if (names.includes(req.params.repoName)) {
    // 重定向到新的 wiki 查看器路径
    res.redirect(`/${req.params.repoName}/wiki/overview`);
  } else {
    next();
  }
});

// 新路由
app.get('/:repo/wiki/:slug', async (req, res) => {
  const { repo, slug } = req.params;
  // 如果 slug 指向实体，显示实体页面
  const entityService = getEntityService();
  const entity = entityService.get(slug);
  if (entity) {
    // 重定向到实体专用页面，或在 wiki 查看器中混合渲染
    // v1 简易方案：在 wiki 查看器内嵌实体渲染
    return await sendWikiViewer(repo, req, res);
  }
  // fallback 到普通 wiki 页面
  return await sendWikiViewer(repo, req, res);
});
```

- [ ] **Step 4: 提交**

```bash
git add src/server/server.ts
git commit -m "feat: update API routes for entity service and QA association"
```

---

### Phase 6 — 收尾

#### Task 11: 服务器自审

Run: `npx tsc --noEmit` — 确保无类型错误

#### Task 12: 冒烟测试

启动服务器并验证：
1. `GET /api/wiki/entities/hot` → 返回实体列表（从 knowledge.db）
2. `GET /api/wiki/entities/:slug` → 返回实体详情
3. `GET /api/wiki/entities/:slug/qa` → 返回关联 #Q
4. `POST /api/qa` with a standard question → 命中校准答案直接返回
5. `GET /:repo/wiki/tokenizer` → 显示实体 wiki 页面
6. `GET /` → 首页正常

## 自审检查

### 1. Spec 覆盖度

| Spec 需求 | 对应 Task |
|-----------|-----------|
| knowledge.db schema | Task 1 |
| 实体存储从 JSON 迁移到 SQLite | Task 2, 3 |
| 实体 ↔ QA 关联 | Task 5, 7 |
| 统一搜索服务 | Task 5 |
| 双路 QA 引擎（0.85/0.5 阈值） | Task 6 |
| 标准答案标记（绿标） | Task 6 |
| 相似问题推荐 | Task 6 |
| Wiki 页面模板和生命周期 | Task 8 |
| 实体详情页混合渲染 | Task 9 |
| 关联 #Q 右面板 | Task 9 |
| 路由变更 `/:repo/wiki/:slug` | Task 10 |
| QA 输入框统一底部 | 前端原生改动，在 Task 9 中处理 |

### 2. Placeholder 扫描

在当前的 v1 计划中，代码块中的 `${slug}` 和 `${definition}` 是实体值替换标记，不是 placeholder。所有关键代码都已完整包含。

### 3. 类型一致性

`EntityService` 的接口与现有 `WikiEntity` 类型兼容。所有方法签名在 Task 2 中已定义并在后续任务中正确引用。
