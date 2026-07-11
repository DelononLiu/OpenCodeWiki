/**
 * entity-service.test.ts — 单元测试
 *
 * 使用临时目录 + HOME 覆盖，避免污染真实 DB 路径。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { WikiEntity } from './wiki-entity.js';

describe('EntityService', () => {
  let kbMod: Awaited<typeof import('./knowledge-db.js')>;
  let service: Awaited<typeof import('./entity-service.js')>;
  let tmpDir: string;
  let origHome: string | undefined;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-service-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    kbMod = await import('./knowledge-db.js');
    kbMod.initKnowledgeDb();
    service = await import('./entity-service.js');
  });

  after(() => {
    if (kbMod) kbMod.closeKnowledgeDb();
    process.env.HOME = origHome ?? '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntity(slug: string, overrides: Partial<WikiEntity> = {}): WikiEntity {
    return {
      slug,
      name: overrides.name ?? slug,
      status: overrides.status ?? 'draft',
      definition: overrides.definition ?? `${slug} definition`,
      project: overrides.project ?? 'test',
      content: overrides.content ?? '',
      searchCount: overrides.searchCount ?? 0,
      files: overrides.files ?? [],
      relations: overrides.relations ?? [],
    };
  }

  it('save + get: 新增实体并可读取', () => {
    const svc = new service.EntityService();
    const entity = makeEntity('save-get-test', {
      name: 'SaveGet Test',
      definition: 'A test entity for save+get',
      status: 'draft',
      project: 'test-project',
    });

    svc.save(entity);

    const loaded = svc.get('save-get-test');
    assert.ok(loaded, '实体应存在');
    assert.strictEqual(loaded!.slug, 'save-get-test');
    assert.strictEqual(loaded!.name, 'SaveGet Test');
    assert.strictEqual(loaded!.definition, 'A test entity for save+get');
    assert.strictEqual(loaded!.status, 'draft');
    assert.strictEqual(loaded!.project, 'test-project');
    assert.ok(Array.isArray(loaded!.files));
    assert.ok(Array.isArray(loaded!.relations));
  });

  it('save: 更新已有实体', () => {
    const svc = new service.EntityService();
    const entity = makeEntity('save-update-test', {
      name: 'Original Name',
      definition: 'Original definition',
      status: 'draft',
    });
    svc.save(entity);

    const updated = makeEntity('save-update-test', {
      name: 'Updated Name',
      definition: 'Updated definition',
      status: 'reviewed',
    });
    svc.save(updated);

    const loaded = svc.get('save-update-test');
    assert.strictEqual(loaded!.name, 'Updated Name');
    assert.strictEqual(loaded!.definition, 'Updated definition');
    assert.strictEqual(loaded!.status, 'reviewed');
  });

  it('save: 处理关联文件和关系', () => {
    const svc = new service.EntityService();
    // 先创建被引用的实体，满足 FK 约束
    svc.save(makeEntity('entity-a'));
    svc.save(makeEntity('entity-b'));
    const entity = makeEntity('save-files-rels', {
      name: 'Files & Relations',
      files: [
        { path: 'src/foo.ts', symbols: ['Foo', 'fooFunc'] },
        { path: 'src/bar.ts', symbols: ['Bar'] },
      ],
      relations: [
        { target: 'entity-a', type: 'depends-on' },
        { target: 'entity-b', type: 'related' },
      ],
    });
    svc.save(entity);

    const loaded = svc.get('save-files-rels');
    assert.strictEqual(loaded!.files.length, 2);

    // 文件按 path 排序（PK 顺序）
    const filesByPath = loaded!.files.slice().sort((a, b) => a.path.localeCompare(b.path));
    assert.strictEqual(filesByPath[0].path, 'src/bar.ts');
    assert.deepStrictEqual(filesByPath[0].symbols, ['Bar']);
    assert.strictEqual(filesByPath[1].path, 'src/foo.ts');
    assert.deepStrictEqual(filesByPath[1].symbols, ['Foo', 'fooFunc']);

    assert.strictEqual(loaded!.relations.length, 2);
    const relsByTarget = loaded!.relations.slice().sort((a, b) => a.target.localeCompare(b.target));
    assert.strictEqual(relsByTarget[0].target, 'entity-a');
    assert.strictEqual(loaded!.relations[0].type, 'depends-on');
  });

  it('get: 不存在的 slug 返回 null', () => {
    const svc = new service.EntityService();
    const result = svc.get('non-existent-slug');
    assert.strictEqual(result, null);
  });

  it('all: 返回所有实体，按 search_count 降序', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('all-a', { name: 'A', searchCount: 5 }));
    svc.save(makeEntity('all-b', { name: 'B', searchCount: 10 }));
    svc.save(makeEntity('all-c', { name: 'C', searchCount: 1 }));

    const all = svc.all();
    const slugs = all.map(e => e.slug);

    // all-b (10) 应该排在 all-a (5) 之前，all-a 在 all-c (1) 之前
    assert.ok(slugs.indexOf('all-b') < slugs.indexOf('all-a'), 'searchCount 降序');
    assert.ok(slugs.indexOf('all-a') < slugs.indexOf('all-c'), 'searchCount 降序');
  });

  it('search: FTS5 精确匹配', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('search-fts', {
      name: 'FTS Match Entity',
      definition: 'This entity is for testing FTS search',
    }));

    const results = svc.search('FTS');
    assert.ok(results.length >= 1, 'FTS 搜索应返回结果');
    const slugs = results.map(r => r.slug);
    assert.ok(slugs.includes('search-fts'), '应匹配到 search-fts');
  });

  it('search: FTS5 无结果时回退到 LIKE 模糊匹配', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('search-like', {
      name: 'LikeTestEntity',
      definition: 'some unique definition here',
    }));

    // 使用特殊格式让 FTS5 失败，确保回退
    const results = svc.search('like');
    const slugs = results.map(r => r.slug);
    assert.ok(slugs.includes('search-like'), 'LIKE 回退应匹配到 search-like');
  });

  it('search: 匹配定义中的内容', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('search-def', {
      name: 'DefTest',
      definition: 'this is a very specific description for searching',
    }));

    const results = svc.search('specific description');
    const slugs = results.map(r => r.slug);
    assert.ok(slugs.includes('search-def'), '应匹配到定义内容');
  });

  it('hot: 返回按 search_count 排序的热门实体（限制数量）', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('hot-a', { name: 'Hot A', searchCount: 100 }));
    svc.save(makeEntity('hot-b', { name: 'Hot B', searchCount: 50 }));
    svc.save(makeEntity('hot-c', { name: 'Hot C', searchCount: 10 }));

    const top2 = svc.hot(2);
    assert.strictEqual(top2.length, 2, '应限制返回数量');
    assert.strictEqual(top2[0].searchCount, 100, '第一个应是最热门的');
    assert.strictEqual(top2[1].searchCount, 50, '第二个应该是次热门的');
  });

  it('hot: 默认限制 10 个', () => {
    const svc = new service.EntityService();
    for (let i = 1; i <= 15; i++) {
      svc.save(makeEntity(`hot-default-${i}`, { name: `Hot ${i}`, searchCount: i }));
    }

    const results = svc.hot();
    assert.strictEqual(results.length, 10, '默认 limit 应为 10');
  });

  it('bump: 增加指定实体的 search_count', () => {
    const svc = new service.EntityService();
    svc.save(makeEntity('bump-test', { name: 'Bump Test', searchCount: 5 }));

    svc.bump('bump-test');
    svc.bump('bump-test');
    svc.bump('bump-test');

    const loaded = svc.get('bump-test');
    assert.strictEqual(loaded!.searchCount, 8, 'search_count 应从 5 增加到 8');
  });

  it('delete: 删除实体及其关联数据', () => {
    const svc = new service.EntityService();
    // 先创建被引用的实体，满足 FK 约束
    svc.save(makeEntity('some-entity'));
    svc.save(makeEntity('delete-test', {
      name: 'Delete Test',
      files: [{ path: 'src/to-delete.ts', symbols: ['ToDelete'] }],
      relations: [{ target: 'some-entity', type: 'related' }],
    }));

    // 先确认存在
    assert.ok(svc.get('delete-test'));

    svc.delete('delete-test');

    // 删除后应返回 null
    assert.strictEqual(svc.get('delete-test'), null);

    // 关联的文件和关系应级联删除（不报错即验证通过）
    assert.doesNotThrow(() => {
      svc.save(makeEntity('delete-test'));
    });
  });

  it('接受合法 status 值：draft / reviewed / published', () => {
    const svc = new service.EntityService();
    for (const status of ['draft', 'reviewed', 'published'] as const) {
      svc.save(makeEntity(`status-${status}`, { status }));
      const loaded = svc.get(`status-${status}`);
      assert.strictEqual(loaded!.status, status, `status "${status}" 应被接受`);
    }
  });

  it('拒绝非法 status 值', () => {
    const svc = new service.EntityService();
    const badEntity = makeEntity('bad-status', {
      status: 'invalid' as any,
    });

    assert.throws(
      () => svc.save(badEntity),
      /CHECK constraint failed/,
      '非法 status 应触发 CHECK 约束错误',
    );
  });
});
