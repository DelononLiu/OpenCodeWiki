/**
 * Codegraph Wiki Integration
 *
 * Reads wiki content generated from codegraph data stored in
 * `.codegraph/wiki/` directory. The wiki is generated via the
 * `scripts/wiki.mjs` CLI or the `/api/wiki/generate` endpoint.
 *
 * Wiki output from codegraph:
 *   {repoRoot}/.codegraph/wiki/
 *   ├── overview.md          — project overview page
 *   ├── {slug}.md            — module pages
 *   ├── module_tree.json     — navigation structure
 *   ├── meta.json            — generation metadata
 *   └── index.html           — standalone viewer (optional)
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/** Module tree node from GitNexus wiki. */
export interface ModuleTreeNode {
  name: string;
  slug: string;
  files: string[];
  children?: ModuleTreeNode[];
}

/** Wiki generation result. */
export interface WikiGenerateResult {
  success: boolean;
  pages?: number;
  output_dir?: string;
  error?: string;
}

/**
 * Generate wiki for a repo using codegraph DB.
 * Creates module_tree.json and overview.md from the codegraph index.
 * Returns a promise that resolves when done.
 */
export async function generateWiki(repoPath: string): Promise<WikiGenerateResult> {
  const outputDir = wikiOutputDir(repoPath);
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');

  if (!fsSync.existsSync(dbPath)) {
    return { success: false, error: 'No codegraph DB found at ' + dbPath + '. Run codegraph index first.' };
  }

  try {
    await fs.mkdir(outputDir, { recursive: true });

    // Generate module_tree.json from codegraph DB file paths
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare("SELECT path FROM files WHERE path NOT LIKE 'node_modules/%' AND path NOT LIKE '.%'").all() as any[];
    const dirMap: Record<string, { name: string; slug: string; files: string[]; children: any[] }> = {};
    for (const r of rows) {
      const p = r.path;
      const parts = p.split('/');
      const topDir = parts.length >= 2 ? parts[0] : '(root)';
      if (!dirMap[topDir]) {
        dirMap[topDir] = { name: topDir, slug: topDir.toLowerCase().replace(/[^a-z0-9]+/g, '-'), files: [], children: [] };
      }
      dirMap[topDir].files.push(p);
    }
    const tree = Object.keys(dirMap).sort().map(k => {
      const m = dirMap[k];
      const subMap: Record<string, { name: string; slug: string; files: string[] }> = {};
      for (const f of m.files) {
        const parts = f.split('/');
        if (parts.length >= 3) {
          const subKey = parts[0] + '-' + parts[1];
          if (!subMap[subKey]) {
            subMap[subKey] = { name: parts[0] + '/' + parts[1], slug: subKey.toLowerCase().replace(/[^a-z0-9]+/g, '-'), files: [] };
          }
          subMap[subKey].files.push(f);
        }
      }
      m.children = Object.keys(subMap).sort().map(sk => subMap[sk]);
      delete (m as any).files;
      return m;
    });
    await fs.writeFile(path.join(outputDir, 'module_tree.json'), JSON.stringify(tree, null, 2), 'utf-8');

    // Generate overview.md from README + codegraph stats
    let overview = '';
    for (const name of ['README.md', 'README', 'readme.md']) {
      try {
        overview = await fs.readFile(path.join(repoPath, name), 'utf-8');
        break;
      } catch {}
    }

    const fileCount = db.prepare('SELECT COUNT(*) AS c FROM files').get() as any;
    const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as any;
    const langRows = db.prepare("SELECT language, COUNT(*) AS c FROM files WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC LIMIT 5").all() as any[];
    db.close();

    let statsSection = `\n\n---\n\n## 📊 代码统计\n\n`;
    statsSection += `- **文件数:** ${fileCount.c}\n`;
    statsSection += `- **符号数:** ${nodeCount.c}\n`;
    if (langRows.length > 0) {
      statsSection += '- **语言:**\n';
      for (const l of langRows) {
        statsSection += `  - ${l.language}: ${l.c} 文件\n`;
      }
    }
    overview += statsSection;

    await fs.writeFile(path.join(outputDir, 'overview.md'), overview || '# Overview\n\n（暂无内容）\n', 'utf-8');

    return {
      success: true,
      pages: tree.length + 1,
      output_dir: outputDir,
    };
  } catch (err: any) {
    return { success: false, error: `Wiki generation failed: ${err.message}` };
  }
}

/**
 * Read a specific wiki page by slug (without .md extension).
 * Returns null if the page doesn't exist.
 */
export async function readWikiPage(wikiDir: string, slug: string): Promise<string | null> {
  const safe = path.basename(slug).replace(/\.\./g, '');
  const filePath = path.join(wikiDir, `${safe}.md`);
  if (!filePath.startsWith(path.resolve(wikiDir))) return null;
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Read the overview page. */
export async function readWikiOverview(wikiDir: string): Promise<string | null> {
  return readWikiPage(wikiDir, 'overview');
}

/** List all wiki page slugs (filenames without .md). */
export async function listWikiPages(wikiDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(wikiDir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => e.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** Load the module tree for navigation sidebar. */
export async function loadModuleTree(wikiDir: string): Promise<ModuleTreeNode[]> {
  try {
    const raw = await fs.readFile(path.join(wikiDir, 'module_tree.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Default wiki directory for a repo (.codegraph/wiki/). */
export function wikiOutputDir(repoPath: string): string {
  return path.join(repoPath, '.codegraph', 'wiki');
}
