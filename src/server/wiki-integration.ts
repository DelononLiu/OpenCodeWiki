/**
 * CRG Wiki Integration
 *
 * Thin bridge that calls CRG (code-review-graph) Python library to generate
 * wiki Markdown files from code community structure. No TypeScript rewrite —
 * CRG is used as-is via a Python subprocess.
 *
 * Output directory: {repoRoot}/.codegraph/wiki/
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'crg-wiki.py');

/** Result from the Python bridge script. */
export interface WikiGenerateResult {
  success: boolean;
  generated?: number;
  updated?: number;
  unchanged?: number;
  total?: number;
  output_dir?: string;
  error?: string;
  needs_build?: boolean;
}

/**
 * Generate wiki for a repo by calling CRG.
 * CRG builds its index on first run; subsequent runs are incremental.
 *
 * @param repoPath  Absolute path to the repository root.
 * @param outputDir Where wiki .md files should be written.
 * @param force     Regenerate all pages even if content unchanged.
 */
export function generateWiki(
  repoPath: string,
  outputDir: string,
  force = false,
): Promise<WikiGenerateResult> {
  return new Promise((resolve) => {
    const args = [BRIDGE_SCRIPT, repoPath, outputDir];
    if (force) args.push('--force');

    const child = execFile('python3', args, {
      timeout: 600_000, // 10 min for first build
      maxBuffer: 1024 * 1024,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    child.on('close', (code) => {
      // Try to parse the last JSON line from stdout
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed && typeof parsed.success === 'boolean') {
            resolve(parsed as WikiGenerateResult);
            return;
          }
        } catch { /* not JSON, keep looking */ }
      }

      resolve({
        success: false,
        error: `Bridge exited with code ${code}: ${stderr || stdout || 'no output'}`,
      });
    });

    child.on('error', (err) => {
      resolve({ success: false, error: `Failed to spawn bridge: ${err.message}` });
    });
  });
}

/**
 * Ensure wiki exists for a repo. Generates if missing, skips if already present.
 * Returns true if wiki was already present (no generation needed).
 */
export async function ensureWiki(repoPath: string, outputDir: string): Promise<boolean> {
  const indexPath = path.join(outputDir, 'index.md');
  try {
    await fs.access(indexPath);
    return true; // already exists
  } catch {
    const result = await generateWiki(repoPath, outputDir, false);
    if (!result.success) {
      // If the build was needed, run generateWiki which will trigger the build
      if (result.needs_build) {
        const retry = await generateWiki(repoPath, outputDir, false);
        if (!retry.success) {
          console.error(`[wiki] Generation failed for ${repoPath}: ${retry.error}`);
          return false;
        }
        return true;
      }
      console.error(`[wiki] Generation failed for ${repoPath}: ${result.error}`);
      return false;
    }
    return true;
  }
}

/** Read a specific wiki page by filename (without .md extension). */
export async function readWikiPage(outputDir: string, pageName: string): Promise<string | null> {
  // Sanitize: no path traversal
  const safe = path.basename(pageName).replace(/\.\./g, '');
  const filePath = path.join(outputDir, `${safe}.md`);

  // Ensure it's within outputDir
  if (!filePath.startsWith(path.resolve(outputDir))) return null;

  try {
    await fs.access(filePath);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Read the wiki index page (index.md). */
export async function readWikiIndex(outputDir: string): Promise<string | null> {
  return readWikiPage(outputDir, 'index');
}

/** List all wiki page slugs (filenames without .md). */
export async function listWikiPages(outputDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => e.name.slice(0, -3)) // remove .md
      .sort();
  } catch {
    return [];
  }
}

/** Default wiki output directory for a repo. */
export function wikiOutputDir(repoPath: string): string {
  return path.join(repoPath, '.codegraph', 'wiki');
}
