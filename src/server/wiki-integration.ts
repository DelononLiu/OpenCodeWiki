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

    // ── Query codegraph DB ──
    const db = new DatabaseSync(dbPath);
    const files = db.prepare("SELECT path FROM files WHERE path NOT LIKE 'node_modules/%' AND path NOT LIKE '.%' AND path NOT LIKE 'dist/%' AND path NOT LIKE 'target/%'").all() as any[];
    const exportsRows = db.prepare("SELECT file_path, name, kind FROM nodes WHERE is_exported = 1").all() as any[];
    const edges = db.prepare(`
      SELECT n1.file_path AS caller, n2.file_path AS callee, COUNT(*) AS count
      FROM edges e JOIN nodes n1 ON e.source = n1.id JOIN nodes n2 ON e.target = n2.id
      WHERE e.kind IN ('calls','imports','references') AND n1.file_path != n2.file_path
      GROUP BY n1.file_path, n2.file_path ORDER BY count DESC
    `).all() as any[];
    const dataModel = db.prepare(`
      SELECT name, kind, file_path, signature, docstring,
        (SELECT COUNT(*) FROM edges e2 JOIN nodes n3 ON e2.target = n3.id WHERE n3.name = nodes.name AND n3.file_path = nodes.file_path) AS refs
      FROM nodes WHERE kind IN ('interface', 'class') AND is_exported = 1 ORDER BY refs DESC LIMIT 40
    `).all() as any[];
    const fileCount = db.prepare('SELECT COUNT(*) AS c FROM files').get() as any;
    const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as any;
    const langRows = db.prepare("SELECT language, COUNT(*) AS c FROM files WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC LIMIT 5").all() as any[];
    db.close();

    // ── Group files by top-level directory ──
    const dirMap: Record<string, string[]> = {};
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '__pycache__', 'vendor']);
    for (const f of files) {
      const parts = (f as any).path.split('/');
      const topDir = parts.length >= 2 && !SKIP_DIRS.has(parts[0]) ? parts[0] : null;
      if (topDir) {
        if (!dirMap[topDir]) dirMap[topDir] = [];
        dirMap[topDir].push((f as any).path);
      }
    }

    // ── Build module tree with dependency info ──
    const tree: any[] = [];
    for (const name of Object.keys(dirMap).sort()) {
      const modFiles = dirMap[name];
      const fileSet = new Set(modFiles);
      const depSet = new Set<string>();
      const depBySet = new Set<string>();

      for (const e of edges) {
        if (fileSet.has((e as any).caller)) {
          for (const [mName, mFiles] of Object.entries(dirMap)) {
            if (mName !== name && mFiles.includes((e as any).callee)) { depSet.add(mName); break; }
          }
        }
        if (fileSet.has((e as any).callee)) {
          for (const [mName, mFiles] of Object.entries(dirMap)) {
            if (mName !== name && mFiles.includes((e as any).caller)) { depBySet.add(mName); break; }
          }
        }
      }

      tree.push({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        files: modFiles,
        dependencies: [...depSet].sort(),
        dependents: [...depBySet].sort(),
        children: [],
      });
    }

    await fs.writeFile(path.join(outputDir, 'module_tree.json'), JSON.stringify(tree, null, 2), 'utf-8');

    // ── Generate overview.md ──
    let overview = '';
    for (const name of ['README.md', 'README', 'readme.md']) {
      try { overview = await fs.readFile(path.join(repoPath, name), 'utf-8'); break; } catch {}
    }

    if (tree.length > 0) {
      overview += '\n\n---\n\n## 🏗️ 架构概览\n\n### 模块依赖关系\n\n```mermaid\nflowchart LR\n';
      const added = new Set<string>();
      for (const mod of tree) {
        const modId = mod.slug.replace(/[^a-zA-Z0-9]/g, '_');
        overview += `  ${modId}[${mod.name}]\n`;
        if (mod.dependencies) {
          for (const dep of mod.dependencies) {
            const depSlug = dep.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/[^a-zA-Z0-9]/g, '_');
            const edge = `${modId}-->${depSlug}`;
            if (!added.has(edge)) { overview += `  ${edge}\n`; added.add(edge); }
          }
        }
      }
      overview += '```\n\n';

      overview += '### 模块清单\n\n| 模块 | 文件数 | 依赖 | 被依赖 |\n|------|--------|------|--------|\n';
      for (const mod of tree) {
        const deps = mod.dependencies?.length ? mod.dependencies.join(', ') : '-';
        const depBy = mod.dependents?.length ? mod.dependents.join(', ') : '-';
        overview += `| **${mod.name}** | ${mod.files?.length || 0} | ${deps} | ${depBy} |\n`;
      }
      overview += '\n';
    }

    let statsSection = `\n\n---\n\n## 📊 代码统计\n\n`;
    statsSection += `- **文件数:** ${fileCount.c}\n`;
    statsSection += `- **符号数:** ${nodeCount.c}\n`;
    if (langRows.length > 0) {
      statsSection += '- **语言:**\n';
      for (const l of langRows) {
        statsSection += `  - ${(l as any).language}: ${(l as any).c} 文件\n`;
      }
    }
    overview += statsSection;
    await fs.writeFile(path.join(outputDir, 'overview.md'), overview || '# Overview\n\n（暂无内容）\n', 'utf-8');

    // ── Generate data-model.md ──
    if (dataModel.length > 0) {
      const groups: Record<string, any[]> = {};
      for (const r of dataModel) {
        const dir = (r as any).file_path.split('/')[0];
        if (!groups[dir]) groups[dir] = [];
        groups[dir].push(r);
      }
      let dm = '# 📐 数据结构设计\n\n核心 interface 和 class 定义，按模块分组。\n\n';
      for (const [dir, items] of Object.entries(groups)) {
        dm += `## ${dir}\n\n| 名称 | 类型 | 文件 | 引用次数 | 签名 |\n|------|------|------|----------|------|\n`;
        for (const item of items) {
          const sig = ((item as any).signature || '').slice(0, 80);
          const doc = ((item as any).docstring || '').slice(0, 60).replace(/\n/g, ' ');
          dm += `| \`${(item as any).name}\` | ${(item as any).kind} | \`${(item as any).file_path}\` | ${(item as any).refs} | ${doc || sig} |\n`;
        }
        dm += '\n';
      }
      await fs.writeFile(path.join(outputDir, 'data-model.md'), dm, 'utf-8');
    }

    return { success: true, pages: tree.length + 2, output_dir: outputDir };
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
