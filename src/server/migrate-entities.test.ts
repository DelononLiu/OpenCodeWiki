/**
 * migrate-entities.test.ts — 单元测试
 *
 * 使用临时目录 + HOME 覆盖，避免污染真实数据路径。
 * 每个测试 case 开始前清空 entities 目录以确保隔离。
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('migrateEntitiesFromJson', () => {
  let kbMod: Awaited<typeof import('./knowledge-db.js')>;
  let migrateMod: Awaited<typeof import('./migrate-entities.js')>;
  let tmpDir: string;
  let entitiesDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    // 每个测试清空 entities 目录
    try {
      const files = fs.readdirSync(entitiesDir);
      for (const f of files) {
        fs.rmSync(path.join(entitiesDir, f), { force: true });
      }
    } catch {
      // 目录可能尚不存在
    }
  });

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    entitiesDir = path.join(tmpDir, '.opencodewiki', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;

    kbMod = await import('./knowledge-db.js');
    kbMod.initKnowledgeDb();
    migrateMod = await import('./migrate-entities.js');
  });

  after(() => {
    if (kbMod) kbMod.closeKnowledgeDb();
    process.env.HOME = origHome ?? '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空目录返回 0 迁移', () => {
    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 0);
    assert.strictEqual(result.errors, 0);
  });

  it('迁移单个实体，验证 status 映射 initial → draft', () => {
    const entity = {
      slug: 'initial-status',
      name: 'Initial Status',
      status: 'initial',
      definition: 'An entity with initial status',
      project: 'test',
      content: 'some content',
      searchCount: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(entitiesDir, 'initial-status.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);
    assert.strictEqual(result.errors, 0);

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('initial-status') as any;
    assert.ok(row, '实体应存在于数据库中');
    assert.strictEqual(row.name, 'Initial Status');
    assert.strictEqual(row.status, 'draft', 'initial 应映射为 draft');
    assert.strictEqual(row.definition, 'An entity with initial status');
    assert.strictEqual(row.project, 'test');
    assert.strictEqual(row.search_count, 3);
  });

  it('映射 calibrated → reviewed', () => {
    const entity = {
      slug: 'calibrated-status',
      name: 'Calibrated Status',
      status: 'calibrated',
      definition: 'calibrated entity',
      project: 'test',
      searchCount: 0,
    };
    fs.writeFileSync(path.join(entitiesDir, 'calibrated-status.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('calibrated-status') as any;
    assert.strictEqual(row.status, 'reviewed', 'calibrated 应映射为 reviewed');
  });

  it('映射 filled → published', () => {
    const entity = {
      slug: 'filled-status',
      name: 'Filled Status',
      status: 'filled',
      definition: 'filled entity',
      project: 'test',
    };
    fs.writeFileSync(path.join(entitiesDir, 'filled-status.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('filled-status') as any;
    assert.strictEqual(row.status, 'published', 'filled 应映射为 published');
  });

  it('无 status 字段默认为 draft', () => {
    const entity = {
      slug: 'no-status',
      name: 'No Status',
      definition: 'entity without status field',
    };
    fs.writeFileSync(path.join(entitiesDir, 'no-status.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('no-status') as any;
    assert.strictEqual(row.status, 'draft', '无 status 应默认为 draft');
  });

  it('未知 status 值映射为 draft', () => {
    const entity = {
      slug: 'unknown-status',
      name: 'Unknown Status',
      status: 'made_up_value',
      definition: 'entity with unknown status',
    };
    fs.writeFileSync(path.join(entitiesDir, 'unknown-status.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('unknown-status') as any;
    assert.strictEqual(row.status, 'draft', '未知 status 应默认为 draft');
  });

  it('迁移关联的文件', () => {
    const entity = {
      slug: 'with-files',
      name: 'With Files',
      status: 'initial',
      definition: 'entity with file associations',
      files: [
        { path: 'src/foo.ts', symbols: ['Foo', 'fooFunc'] },
        { path: 'src/bar.ts', symbols: ['Bar'] },
      ],
    };
    fs.writeFileSync(path.join(entitiesDir, 'with-files.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);
    assert.strictEqual(result.errors, 0);

    const db = kbMod.getKnowledgeDb();
    const files = db
      .prepare('SELECT * FROM entity_files WHERE entity_slug = ? ORDER BY path')
      .all('with-files') as any[];
    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0].path, 'src/bar.ts');
    assert.deepStrictEqual(JSON.parse(files[0].symbols), ['Bar']);
    assert.strictEqual(files[1].path, 'src/foo.ts');
    assert.deepStrictEqual(JSON.parse(files[1].symbols), ['Foo', 'fooFunc']);
  });

  it('迁移关联的关系', () => {
    // 先将被引用的实体插入 DB，确保 FK 约束可以满足
    const db = kbMod.getKnowledgeDb();
    db.prepare(
      'INSERT OR IGNORE INTO entities(slug, name, status) VALUES (?, ?, ?)',
    ).run('target-a', 'Target A', 'draft');
    db.prepare(
      'INSERT OR IGNORE INTO entities(slug, name, status) VALUES (?, ?, ?)',
    ).run('target-b', 'Target B', 'draft');

    const entity = {
      slug: 'with-relations',
      name: 'With Relations',
      status: 'initial',
      definition: 'entity with relations',
      relations: [
        { target: 'target-a', type: 'depends-on' },
        { target: 'target-b', type: 'related' },
      ],
    };
    fs.writeFileSync(path.join(entitiesDir, 'with-relations.json'), JSON.stringify(entity));

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1);
    assert.strictEqual(result.errors, 0);

    const rels = db
      .prepare('SELECT * FROM entity_relations WHERE source_slug = ? ORDER BY target_slug')
      .all('with-relations') as any[];
    assert.strictEqual(rels.length, 2);
    assert.strictEqual(rels[0].target_slug, 'target-a');
    assert.strictEqual(rels[0].relation_type, 'depends-on');
    assert.strictEqual(rels[1].target_slug, 'target-b');
    assert.strictEqual(rels[1].relation_type, 'related');
  });

  it('INSERT OR IGNORE — 已存在实体跳过', () => {
    const entity = {
      slug: 'duplicate-slug',
      name: 'Original Name',
      status: 'initial',
      definition: 'original',
    };
    fs.writeFileSync(path.join(entitiesDir, 'duplicate-slug.json'), JSON.stringify(entity));

    // 第一次迁移
    const result1 = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result1.migrated, 1);

    // 修改数据再迁一次（但文件没变，还是原始数据，因为 beforeEach 不会清除已写入的文件）
    // 实际我们在 beforeEach 中已经清空了，所以重新写一次
    // 现在写入修改后的版本
    fs.writeFileSync(
      path.join(entitiesDir, 'duplicate-slug.json'),
      JSON.stringify({ ...entity, name: 'Modified Name', definition: 'modified' }),
    );

    const result2 = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result2.migrated, 0, '重复迁移应被 IGNORE');

    // 验证值没有被覆盖
    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('duplicate-slug') as any;
    assert.strictEqual(row.name, 'Original Name', 'INSERT OR IGNORE 不应覆盖已有记录');
  });

  it('非法 JSON 文件计入 errors', () => {
    fs.writeFileSync(path.join(entitiesDir, 'invalid.json'), 'not valid json content');

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 0);
    assert.strictEqual(result.errors, 1);
  });

  it('非 .json 文件被忽略', () => {
    fs.writeFileSync(path.join(entitiesDir, 'readme.md'), '# Markdown file');
    fs.writeFileSync(path.join(entitiesDir, 'data.txt'), 'text content');

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 0);
    assert.strictEqual(result.errors, 0);
  });

  it('slug 从实体数据中提取，回退到文件名', () => {
    // 有 slug 字段
    fs.writeFileSync(
      path.join(entitiesDir, 'explicit-slug.json'),
      JSON.stringify({ slug: 'explicit-slug', name: 'Explicit', status: 'initial', definition: 'x' }),
    );

    // 无 slug 字段，回退到文件名
    fs.writeFileSync(
      path.join(entitiesDir, 'file-based.json'),
      JSON.stringify({ name: 'FileBased', status: 'initial', definition: 'y' }),
    );

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 2);
    assert.strictEqual(result.errors, 0);

    const db = kbMod.getKnowledgeDb();
    const row1 = db.prepare('SELECT * FROM entities WHERE slug = ?').get('explicit-slug') as any;
    assert.ok(row1, '显式 slug 应使用 slug 字段');

    const row2 = db.prepare('SELECT * FROM entities WHERE slug = ?').get('file-based') as any;
    assert.ok(row2, '无 slug 时应使用文件名作为 slug');
    assert.strictEqual(row2.name, 'FileBased');
  });

  it('批量迁移多种状态实体', () => {
    const entities = [
      { slug: 'batch-initial', name: 'Batch Initial', status: 'initial', definition: 'a' },
      { slug: 'batch-calibrated', name: 'Batch Calibrated', status: 'calibrated', definition: 'b' },
      { slug: 'batch-filled', name: 'Batch Filled', status: 'filled', definition: 'c' },
    ];
    for (const e of entities) {
      fs.writeFileSync(path.join(entitiesDir, `${e.slug}.json`), JSON.stringify(e));
    }

    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 3);
    assert.strictEqual(result.errors, 0);

    const db = kbMod.getKnowledgeDb();
    const statuses = ['batch-initial', 'batch-calibrated', 'batch-filled'].map((slug) => {
      const row = db.prepare('SELECT status FROM entities WHERE slug = ?').get(slug) as any;
      return row?.status;
    });
    assert.deepStrictEqual(statuses, ['draft', 'reviewed', 'published']);
  });

  it('关系指向不存在的目标实体时不会中断整体迁移', () => {
    const entity = {
      slug: 'orphan-relation',
      name: 'Orphan Relation',
      status: 'initial',
      definition: 'entity with relation to non-existent target',
      relations: [{ target: 'ghost-entity', type: 'depends-on' }],
    };
    fs.writeFileSync(path.join(entitiesDir, 'orphan-relation.json'), JSON.stringify(entity));

    // 不应抛出异常，整体迁移应成功，仅有关系被跳过
    const result = migrateMod.migrateEntitiesFromJson();
    assert.strictEqual(result.migrated, 1, '实体本身应被迁移');
    assert.strictEqual(result.errors, 0, '关系 FK 失败不应计入实体 errors');

    const db = kbMod.getKnowledgeDb();
    const row = db.prepare('SELECT * FROM entities WHERE slug = ?').get('orphan-relation') as any;
    assert.ok(row, '实体应存在于数据库中');
    assert.strictEqual(row.status, 'draft');

    // 关系应因 FK 约束被跳过
    const rels = db
      .prepare('SELECT * FROM entity_relations WHERE source_slug = ?')
      .all('orphan-relation') as any[];
    assert.strictEqual(rels.length, 0, '指向不存在实体的关系应被跳过');
  });
});
