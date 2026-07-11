/**
 * wiki-page-service.ts — Wiki 页面生命周期管理服务
 *
 * 管理 .md 页面文件的 CRUD，支持 frontmatter 解析与生成。
 * 页面文件存储在 ~/.opencodewiki/pages/ 下，按类型分目录。
 */

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
  const match = content.match(/^---\n([\s\S]*?)(?:\n---|\n?---)\n([\s\S]*)$/);
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
