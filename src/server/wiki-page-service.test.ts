/**
 * wiki-page-service.test.ts — 单元测试
 *
 * 临时目录 + HOME 覆盖，避免污染真实路径。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('WikiPageService', () => {
  let mod: Awaited<typeof import('./wiki-page-service.js')>;
  let tmpDir: string;
  let origHome: string | undefined;
  let pagesDir: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-page-test-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    pagesDir = path.join(tmpDir, '.opencodewiki', 'pages');
    mod = await import('./wiki-page-service.js');
  });

  after(() => {
    process.env.HOME = origHome ?? '';
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ensurePageDirs ──────────────────────────────────────────

  it('ensurePageDirs: 创建四个预期子目录', async () => {
    await mod.ensurePageDirs();
    const expected = ['entities', 'overviews', 'qa-archives', 'templates'];
    for (const dir of expected) {
      const fullPath = path.join(pagesDir, dir);
      assert.ok(fs.existsSync(fullPath), `目录 ${dir} 应存在`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.isDirectory(), `${dir} 应是目录`);
    }
  });

  // ── pageDir ────────────────────────────────────────────────

  it('pageDir: entity 类型映射到 entities 子目录', () => {
    const result = mod.pageDir('entity');
    assert.strictEqual(result, path.join(pagesDir, 'entities'));
  });

  it('pageDir: overview 类型映射到 overviews 子目录', () => {
    const result = mod.pageDir('overview');
    assert.strictEqual(result, path.join(pagesDir, 'overviews'));
  });

  it('pageDir: qa-archive 类型映射到 qa-archives 子目录', () => {
    const result = mod.pageDir('qa-archive');
    assert.strictEqual(result, path.join(pagesDir, 'qa-archives'));
  });

  it('pageDir: 未知类型默认降级到 entities', () => {
    const result = mod.pageDir('unknown-type');
    assert.strictEqual(result, path.join(pagesDir, 'entities'));
  });

  // ── pagePath ───────────────────────────────────────────────

  it('pagePath: 生成正确的 .md 文件路径', () => {
    const result = mod.pagePath('my-slug', 'entity');
    assert.strictEqual(result, path.join(pagesDir, 'entities', 'my-slug.md'));
  });

  // ── writePage + readPage ───────────────────────────────────

  it('writePage + readPage: 写入并读取 .md 文件', async () => {
    const content = '---\nslug: test-page\n---\n\nHello world';
    await mod.writePage('test-page', 'entity', content);
    const result = await mod.readPage('test-page', 'entity');
    assert.strictEqual(result, content);
  });

  it('readPage: 不存在的页面返回 null', async () => {
    const result = await mod.readPage('non-existent', 'entity');
    assert.strictEqual(result, null);
  });

  it('writePage: 自动创建目标子目录（无需预先 ensurePageDirs）', async () => {
    await mod.writePage('auto-dir', 'overview', '# Auto dir test');
    const fullPath = path.join(pagesDir, 'overviews', 'auto-dir.md');
    assert.ok(fs.existsSync(fullPath), '文件应被自动创建');
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    assert.strictEqual(content, '# Auto dir test');
  });

  // ── parseFrontmatter ───────────────────────────────────────

  it('parseFrontmatter: 解析完整 frontmatter', async () => {
    const content = [
      '---',
      'slug: test-entity',
      'page_type: entity',
      'status: published',
      'title: Test Entity',
      'created_by: alice',
      'reviewed_by: bob',
      'published_at: 2026-01-01',
      '---',
      '',
      '# Body content',
      '',
      'Some description.',
    ].join('\n');

    const { meta, body } = await mod.parseFrontmatter(content);
    assert.ok(meta, 'meta 不应为 null');
    assert.strictEqual(meta!.slug, 'test-entity');
    assert.strictEqual(meta!.pageType, 'entity');
    assert.strictEqual(meta!.status, 'published');
    assert.strictEqual(meta!.title, 'Test Entity');
    assert.strictEqual(meta!.createdBy, 'alice');
    assert.strictEqual(meta!.reviewedBy, 'bob');
    assert.strictEqual(meta!.publishedAt, '2026-01-01');
    assert.strictEqual(body, '# Body content\n\nSome description.');
  });

  it('parseFrontmatter: 无 frontmatter 时 meta 为 null', async () => {
    const content = '# Just a title\n\nNo frontmatter here.';
    const { meta, body } = await mod.parseFrontmatter(content);
    assert.strictEqual(meta, null);
    assert.strictEqual(body, '# Just a title\n\nNo frontmatter here.');
  });

  it('parseFrontmatter: 空的 frontmatter 使用默认值', async () => {
    const content = '---\n---\n\nBody text';
    const { meta, body } = await mod.parseFrontmatter(content);
    assert.ok(meta, 'meta 不应为 null');
    assert.strictEqual(meta!.slug, '');
    assert.strictEqual(meta!.pageType, 'entity');
    assert.strictEqual(meta!.status, 'draft');
    assert.strictEqual(meta!.title, '');
    assert.strictEqual(body, 'Body text');
  });

  // ── generateFrontmatter ────────────────────────────────────

  it('generateFrontmatter: 生成包含所有字段的 frontmatter', async () => {
    const meta: import('./wiki-page-service.js').WikiPageMeta = {
      slug: 'my-entity',
      pageType: 'entity',
      status: 'published',
      title: 'My Entity',
      createdBy: 'carol',
      reviewedBy: 'dave',
      publishedAt: '2026-06-15',
    };
    const result = await mod.generateFrontmatter(meta);
    const expected = [
      '---',
      'slug: my-entity',
      'page_type: entity',
      'status: published',
      'title: My Entity',
      'created_by: carol',
      'reviewed_by: dave',
      'published_at: 2026-06-15',
      '---',
    ].join('\n');
    assert.strictEqual(result, expected);
  });

  it('generateFrontmatter: 省略可选空字段', async () => {
    const meta: import('./wiki-page-service.js').WikiPageMeta = {
      slug: 'minimal',
      pageType: 'overview',
      status: 'draft',
      title: 'Minimal',
    };
    const result = await mod.generateFrontmatter(meta);
    assert.ok(result.includes('slug: minimal'));
    assert.ok(result.includes('page_type: overview'));
    assert.ok(result.includes('status: draft'));
    assert.ok(result.includes('title: Minimal'));
    assert.ok(!result.includes('created_by:'));
    assert.ok(!result.includes('reviewed_by:'));
    assert.ok(!result.includes('published_at:'));
  });
});
