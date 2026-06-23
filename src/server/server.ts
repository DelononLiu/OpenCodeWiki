import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createQaEndpoint, getSession, listSessions, listFrequentQuestions, searchQuestions } from './qa-endpoint.js';
import qaRouter, { createLightweightSearchHandler } from './qa-router.js';
import { qaInputStyles, qaInputHtml, qaInputInitScript } from '../shared/qa-input.js';
import { userBarStyles, userBarHtml, userBarInitScript } from '../shared/user-bar.js';
import {
  generateWiki, readWikiPage, loadModuleTree, wikiOutputDir,
} from './wiki-integration.js';
import { setupAuth } from './auth/index.js';
import { CbmBridge, getBridge } from './cbm-bridge.js';

// Vector store — 可选，提供混合检索（FTS5 + 向量 + RRF）
try {
  const vs = await import('./vector-store.mjs');
  (globalThis as any).__vectorStore = vs;
} catch (e) {
  console.warn('[vector] Vector store not available — using FTS5 only');
}

const opencodewikiDir = path.join(os.homedir(), '.opencodewiki');
const registryFile = path.join(opencodewikiDir, 'registry.json');

interface RegistryEntry {
  name: string;
  path: string;
  vcs?: 'git' | 'svn';
  indexedAt?: string;
  files?: number;
  nodes?: number;
  edges?: number;
}

/** Detect VCS type by checking for .git / .svn directory. */
function detectVcs(repoPath: string): 'git' | 'svn' | undefined {
  try {
    if (fsSync.existsSync(path.join(repoPath, '.git'))) return 'git';
    if (fsSync.existsSync(path.join(repoPath, '.svn'))) return 'svn';
  } catch {}
  return undefined;
}

async function loadRegistry(): Promise<RegistryEntry[]> {
  try {
    await fs.access(registryFile);
    const raw = await fs.readFile(registryFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRegistry(entries: RegistryEntry[]): Promise<void> {
  await fs.mkdir(opencodewikiDir, { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify(entries, null, 2), 'utf-8');
}

async function getCodegraphStatsFor(projectPath: string) {
  try {
    const projectName = CbmBridge.repoPathToProjectName(projectPath);
    const result = await handler.execute('index_status', { project: projectName });
    const text = result?.content?.[0]?.text || '{}';
    const data = JSON.parse(text);
    // codebase-memory-mcp index_status 不直接返回 file 数，用 nodes/edges 估算
    return { files: data.nodes || 0, nodes: data.nodes || 0, edges: data.edges || 0 };
  } catch {
    return { files: 0, nodes: 0, edges: 0 };
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnv() {
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  try {
    const text = await fs.readFile(envFile, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
await loadEnv();
const rootDir = path.resolve(__dirname, '..', '..');

const vendorDir = path.resolve(rootDir, 'vendor');
const qaIndexFile = path.resolve(rootDir, 'src', 'qa', 'index.html');
const homeIndexFile = path.resolve(rootDir, 'src', 'home', 'index.html');

const handler = await initHandler();

async function initHandler(): Promise<any> {
  const b = getBridge(rootDir);
  if (!b.isAvailable()) {
    console.warn('[cbm] codebase-memory-mcp not available — search/QA will be degraded');
    return {
      execute: async (_method: string, _args?: any) => ({ content: [{ text: '' }] }),
    };
  }
  console.log('[cbm] Using codebase-memory-mcp as index engine');
  return b;
}

/** Dynamic wiki pages: slugs that are generated from codebase-memory-mcp data instead of static .md files. */
const DYNAMIC_WIKI_PAGES = ['dependencies', 'impact-map', 'heatmap', 'gotchas', 'data-model'];

/**
 * 通过 codebase-memory-mcp 获取某个 repo 的架构数据（缓存到全局避免重复调 CLI）。
 * 返回 get_architecture 的完整 JSON 对象，或 null。
 */
let _archCache: Record<string, any> = {};
async function getArchitecture(repoPath: string): Promise<any | null> {
  if (_archCache[repoPath]) return _archCache[repoPath];
  try {
    const projectName = CbmBridge.repoPathToProjectName(repoPath);
    const result = await handler.execute('get_architecture', { project: projectName });
    const text = result?.content?.[0]?.text;
    if (!text) return null;
    const data = JSON.parse(text);
    if (data.error) return null;
    _archCache[repoPath] = data;
    return data;
  } catch { return null; }
}
setInterval(() => { _archCache = {}; }, 10 * 60 * 1000);

/**
 * 通过 codebase-memory-mcp 搜索指定 label 的符号。
 * 返回 search_graph 的 results[] 或空数组。
 */
async function searchByLabel(repoPath: string, label: string, limit = 40): Promise<any[]> {
  try {
    const projectName = CbmBridge.repoPathToProjectName(repoPath);
    const result = await handler.execute('search_graph', {
      name_pattern: '.*',
      label,
      project: projectName,
      limit,
    });
    const text = result?.content?.[0]?.text;
    if (!text) return [];
    return JSON.parse(text).results || [];
  } catch { return []; }
}

/** Generate the 依赖图谱 page — mermaid graph of directory-level dependencies. */
async function generateDependenciesPage(repoPath: string): Promise<string> {
  const arch = await getArchitecture(repoPath);
  let dirDeps = '';
  if (arch?.file_tree) {
    const dirs = new Set<string>();
    for (const entry of arch.file_tree) {
      if (entry.type === 'file') {
        const parts = entry.path.split('/');
        if (parts.length >= 2) dirs.add(parts[0]);
      }
    }
    const sortedDirs = [...dirs].sort();
    dirDeps = sortedDirs.map(d => `  ${d.replace(/[^a-zA-Z0-9]/g, '_')}[${d}]`).join('\n');
  }

  return `## 🌐 依赖图谱

本页展示了仓库中顶层目录之间的依赖关系。数据来源于 codebase-memory-mcp 代码分析。

\`\`\`mermaid
flowchart LR
${dirDeps || '  empty[（暂无数据）]'}
\`\`\`

> 此页面由 codebase-memory-mcp 动态生成，每次访问自动更新。
`;
}

/** Generate the 影响地图 page — modules with widest impact radius. */
async function generateImpactMapPage(repoPath: string): Promise<string> {
  const arch = await getArchitecture(repoPath);
  let impactMd = '*（暂无数据）*';
  if (arch?.hotspots && arch.hotspots.length > 0) {
    // 从 qualified_name 提取文件路径
    // home-long2015-Code-kcode.src.core.ConfigService.ConfigService.get
    // → src/core/ConfigService.ts
    function qnToFile(qn: string): string {
      const parts = qn.split('.');
      const start = parts.indexOf('src');
      if (start < 0) return qn;
      const fileParts: string[] = [];
      for (let i = start; i < parts.length; i++) {
        if (i > start && parts[i] === parts[i - 1]) break; // 文件名与类名重复
        fileParts.push(parts[i]);
      }
      return fileParts.join('/') + '.ts';
    }
    impactMd = '| 符号 | 文件 | 扇入（调用者数） | 影响分 |\n|------|------|----------------|--------|\n';
    const seen = new Set<string>();
    for (const h of arch.hotspots) {
      const fp = qnToFile(h.qualified_name || '');
      const key = `${h.name}:${fp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = (h.fan_in || 0) * 2;
      impactMd += `| \`${h.name}\` | \`${fp}\` | ${h.fan_in || 0} | ${score} |\n`;
      if (seen.size >= 15) break;
    }
  }

  return `## 🔗 影响地图

按"影响半径"排序——被调用越多、扇入越高的符号，修改时需要关注的影响面越大。

${impactMd}

> 此页面由 codebase-memory-mcp 动态生成。
`;
}

/** Generate the 代码热力图 page — hot files by git churn + QA mentions + coupling. */
async function generateHeatmapPage(repoPath: string): Promise<string> {
  // Dimension 1: git churn
  let gitChurn: { file: string; changes: number }[] = [];
  try {
    const { execSync } = await import('child_process');
    const out = execSync('git log --oneline --name-only --pretty=format: -n 100', {
      cwd: repoPath, timeout: 5000, encoding: 'utf-8',
    });
    const freq: Record<string, number> = {};
    for (const file of out.split('\n')) {
      const f = file.trim();
      if (f && !f.startsWith('.') && !f.includes('node_modules')) {
        freq[f] = (freq[f] || 0) + 1;
      }
    }
    gitChurn = Object.entries(freq)
      .map(([file, changes]) => ({ file, changes }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 10);
  } catch {}

  // Dimension 2: codebase-memory hotspots
  const arch = await getArchitecture(repoPath);
  const hotspots = arch?.hotspots?.slice(0, 10) || [];

  let html = '## 📊 代码热力图\n\n';
  html += '结合三个维度：**Git 变更频率** · **符号热度（扇入）** · **模块耦合度**\n\n';

  html += '### 🔄 高频变更文件（最近 100 次提交）\n\n';
  if (gitChurn.length > 0) {
    html += '| 文件 | 变更次数 |\n|------|---------|\n';
    for (const f of gitChurn) {
      html += `| \`${f.file}\` | ${f.changes} |\n`;
    }
  } else {
    html += '*暂无 git 数据*\n';
  }

  html += '\n### 🔥 高热度符号（扇入最高）\n\n';
  if (hotspots.length > 0) {
    html += '| 符号 | 文件 | 扇入 |\n|------|------|------|\n';
    for (const h of hotspots) {
      html += `| \`${h.name}\` | \`${h.file}\` | ${h.fan_in || 0} |\n`;
    }
  } else {
    html += '*暂无 codebase-memory-mcp 数据*\n';
  }

  html += '\n> 此页面由 Git 历史和 codebase-memory-mcp 动态生成。\n';
  return html;
}

/** Generate the 常见踩坑 page — from calibrated QA bug/error entries. */
async function generateGotchasPage(repoPath: string, repoName: string): Promise<string> {
  try {
    // Use the QA store's listEntries function directly
    const { listEntries } = await import('./qa-store.js');
    const result = listEntries({
      repo: repoName,
      calibrated: true,
      sort: 'visit',
      limit: 30,
    });
    if (!result.entries || result.entries.length === 0) {
      return '## 🔥 常见踩坑\n\n暂无已校准的踩坑记录。当 #Q 中有被校准的问答后，会自动出现在这里。\n';
    }
    let md = '## 🔥 常见踩坑\n\n';
    md += '以下内容来自团队在 #Q 中校准过的问答精华：\n\n';
    for (const e of result.entries) {
      const q = e.question;
      md += `### 💬 #Q${e.qid}: ${q}\n\n`;
      md += `- **Domain:** ${e.domain || 'general'}\n`;
      md += `- **访问次数:** ${e.visitCount}\n`;
      md += `- **回答时间:** ${e.answeredAt ? e.answeredAt.slice(0, 10) : '-'}\n`;
      md += `[查看完整问答 →](/qa?qid=${e.qid})\n\n`;
    }
    return md;
  } catch {
    return '## 🔥 常见踩坑\n\n加载失败。\n';
  }
}


/** Generate the 数据结构 page — from codebase-memory-mcp Interface/Class symbols. */
async function generateDataModelPage(repoPath: string): Promise<string> {
  const [interfaces, classes] = await Promise.all([
    searchByLabel(repoPath, 'Interface', 40),
    searchByLabel(repoPath, 'Class', 40),
  ]);
  const rows = [...interfaces, ...classes];
  if (rows.length === 0) return '## 📐 数据结构\n\n暂无核心数据结构。\n';

  // 过滤 .kilo/ 副本 + 按 name:file 去重
  const dedup = new Map<string, any>();
  for (const r of rows) {
    const fp = r.file_path || r.file || '';
    if (fp.includes('/.kilo/')) continue;
    const key = `${r.name}:${fp}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }

  const groups: Record<string, any[]> = {};
  for (const r of dedup.values()) {
    const dir = (r.file_path || r.file || '').split('/')[0];
    if (!dir) continue;
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(r);
  }

  let md = '# 📐 数据结构设计\n\n核心 Interface 和 Class 定义，按模块分组。\n\n';
  for (const [dir, items] of Object.entries(groups)) {
    md += `## ${dir}\n\n`;
    md += '| 名称 | 类型 | 文件 | 扇入 | 签名 |\n|------|------|------|------|------|\n';
    for (const item of items) {
      const sig = (item.signature || '').slice(0, 80);
      md += `| \`${item.name}\` | ${item.label || item.kind || ''} | \`${item.file_path || item.file || ''}\` | ${item.in_degree || 0} | ${sig} |\n`;
    }
    md += '\n';
  }
  return md;
}


const app = express();
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Raw body parser for file uploads
const rawUploadParser = express.raw({
  type: 'application/octet-stream',
  limit: '500mb',
});

// Initialize auth (if configured)
await setupAuth(app);

const UPLOAD_BASE = path.join(os.homedir(), '.opencodewiki', 'uploads');

/** Sanitize filename to prevent path traversal */
function safeName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// TTL cleanup: remove uploads older than 24h
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => cleanupStaleUploads(UPLOAD_BASE, UPLOAD_TTL_MS).catch(() => {}), 30 * 60 * 1000);
setTimeout(() => cleanupStaleUploads(UPLOAD_BASE, UPLOAD_TTL_MS).catch(() => {}), 10_000);

async function cleanupStaleUploads(base: string, ttl: number): Promise<void> {
  const now = Date.now();
  try {
    const entries = await fs.readdir(base);
    for (const entry of entries) {
      const p = path.join(base, entry);
      try {
        const s = await fs.stat(p);
        if (s.isDirectory() && entry.startsWith('ses_') && now - s.mtimeMs > ttl) {
          await fs.rm(p, { recursive: true, force: true }).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

// ── File Upload API ──────────────────────────────────────────────

/** Upload a file (raw binary body). For large files, use chunked upload instead.
 *  Auto-analyzes log/text files on upload — extracts errors and caches results.
 *  Uses `sessionId` (UUID) for isolation — each QA session has its own directory. */
app.post('/api/upload', rawUploadParser, async (req: any, res: any) => {
  const sessionId = req.query.sessionId as string;
  const fileName = req.query.name as string;
  if (!sessionId || !fileName) {
    return res.status(400).json({ error: 'Missing sessionId or name query param' });
  }
  const dir = path.join(UPLOAD_BASE, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const safe = safeName(fileName);
  const dest = path.join(dir, safe);
  await fs.writeFile(dest, req.body as Buffer);
  const stat = await fs.stat(dest);
  console.log(`[upload] saved ${safe} (${stat.size} bytes) for session ${sessionId}`);

  // Auto-extract errors for text/log files
  extractLogErrors(dest, safe, dir).catch((err: any) =>
    console.error(`[upload] error analysis failed for ${safe}:`, err?.message)
  );

  res.json({ fileName: safe, size: stat.size, sessionId });
});

/** Analyze an uploaded file and cache the result as .analysis.json sidecar.
 *  - Log files: extract errors/anomalies via log-analyzer
 *  - Source code: extract symbols/functions, cache metadata + symbol list
 *  - Binary: skip silently */
async function extractLogErrors(filePath: string, fileName: string, dir: string): Promise<void> {
  const textExts = new Set(['.log', '.txt', '.out', '.err', '.json', '.csv', '.md', '.yml', '.yaml', '.xml', '.cfg', '.conf', '.ini', '.toml']);
  const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.kt', '.scala', '.swift', '.rb', '.php', '.vue', '.svelte', '.css', '.scss', '.less']);
  const ext = path.extname(fileName).toLowerCase();
  const isCodeFile = codeExts.has(ext);
  const isLogFile = textExts.has(ext) || !!ext.match(/\.(log|err|out)$/i);
  if (!isCodeFile && !isLogFile) return;

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const totalLines = raw.split('\n').length;
    const size = raw.length;

    let result: any;

    if (isLogFile) {
      const { extractErrors } = await import('./log-analyzer.js');
      result = extractErrors(raw, { contextLines: 2, maxErrors: 30, includeWarnings: true });
    } else {
      // Source code: extract function/class definitions + provide metadata
      const funcRe = /^\s*(export\s+)?(async\s+)?function\s+(\w+)|^\s*(export\s+)?(class|interface|trait|struct|impl)\s+(\w+)|^\s*(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/gm;
      const symbols: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = funcRe.exec(raw)) !== null) {
        const name = m[3] || m[6] || m[9];
        if (name && !symbols.includes(name)) symbols.push(name);
      }
      const symbolList = symbols.slice(0, 50).join(', ');

      result = {
        total: totalLines,
        size,
        extracted: 0,
        severityCounts: { fatal: 0, error: 0, warning: 0 },
        errors: [],
        summary: `Source code file: ${totalLines} lines, ${size} bytes, ${symbols.length} symbols defined`,
        _symbols: symbolList,
        _type: 'source',
      };
    }

    const cachePath = path.join(dir, `.${fileName}.analysis.json`);
    await fs.writeFile(cachePath, JSON.stringify(result), 'utf-8');
    const summary = isLogFile ? `${result.extracted} issues` : `${result._symbols ? result._symbols.split(',').length : 0} symbols`;
    console.log(`[upload] file analysis cached for ${fileName}: ${result.total} lines, ${summary}`);
  } catch {
    // Binary or unreadable — skip silently
  }
}

/** Chunked upload — start a chunked upload session */
app.post('/api/upload/chunked/start', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, totalChunks } = req.body;
  if (!sessionId || !fileName || !totalChunks) {
    return res.status(400).json({ error: 'Missing sessionId, fileName, or totalChunks' });
  }
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(UPLOAD_BASE, sessionId, `.${uploadId}`);
  await fs.mkdir(dir, { recursive: true });
  res.json({ uploadId, totalChunks, chunkDir: dir });
});

/** Chunked upload — upload one chunk (raw binary) */
const chunkParser = express.raw({ type: 'application/octet-stream', limit: '500mb' });
app.post('/api/upload/chunked/:uploadId/:index', chunkParser, async (req: any, res: any) => {
  const { uploadId, index } = req.params;
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
  const chunkDir = path.join(UPLOAD_BASE, sessionId, `.${uploadId}`);
  await fs.mkdir(chunkDir, { recursive: true });
  const chunkFile = path.join(chunkDir, `chunk_${String(index).padStart(6, '0')}`);
  await fs.writeFile(chunkFile, req.body as Buffer);
  res.json({ received: parseInt(index) });
});

/** Chunked upload — complete and reassemble */
app.post('/api/upload/chunked/complete', express.json(), async (req: any, res: any) => {
  const { sessionId, uploadId, fileName } = req.body;
  if (!sessionId || !uploadId || !fileName) {
    return res.status(400).json({ error: 'Missing sessionId, uploadId, or fileName' });
  }
  const chunkDir = path.join(UPLOAD_BASE, sessionId, `.${uploadId}`);
  const destDir = path.join(UPLOAD_BASE, sessionId);
  await fs.mkdir(destDir, { recursive: true });
  const safe = safeName(fileName);
  const dest = path.join(destDir, safe);
  const chunks = await fs.readdir(chunkDir);
  chunks.sort();
  const writeStream = fsSync.createWriteStream(dest);
  for (const chunk of chunks) {
    const data = await fs.readFile(path.join(chunkDir, chunk));
    writeStream.write(data);
  }
  await new Promise<void>((resolve, reject) => {
    writeStream.end((err) => (err ? reject(err) : resolve()));
  });
  // Clean up chunk dir
  await fs.rm(chunkDir, { recursive: true }).catch(() => {});
  const stat = await fs.stat(dest);
  console.log(`[upload] reassembled ${safe} (${stat.size} bytes) for session ${sessionId}`);

  // Auto-extract errors for reassembled files
  extractLogErrors(dest, safe, destDir).catch((err: any) =>
    console.error(`[upload] error analysis failed for ${safe}:`, err?.message)
  );

  res.json({ fileName: safe, size: stat.size, sessionId });
});

/** List uploaded files for a session */
app.get('/api/upload/:sessionId', async (req: any, res: any) => {
  const dir = path.join(UPLOAD_BASE, req.params.sessionId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: { fileName: string; size: number; uploadedAt: string }[] = [];
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const stat = await fs.stat(path.join(dir, entry.name));
        files.push({ fileName: entry.name, size: stat.size, uploadedAt: stat.mtime.toISOString() });
      }
    }
    res.json(files);
  } catch {
    res.json([]);
  }
});

// ── File Query API (for LLM mode - no ACP agent) ───────────────────

/** Read first N lines of an uploaded file */
app.post('/api/file/head', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, lines = 100 } = req.body;
  if (!sessionId || !fileName) return res.status(400).json({ error: 'Missing sessionId or fileName' });
  const fp = path.join(UPLOAD_BASE, sessionId, safeName(fileName));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const allLines = raw.split('\n');
    const head = allLines.slice(0, Math.min(lines, allLines.length));
    const total = allLines.length;
    res.json({ lines: head.length, total, content: head.join('\n') });
  } catch { res.status(404).json({ error: 'File not found' }); }
});

/** Read last N lines of an uploaded file */
app.post('/api/file/tail', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, lines = 100 } = req.body;
  if (!sessionId || !fileName) return res.status(400).json({ error: 'Missing sessionId or fileName' });
  const fp = path.join(UPLOAD_BASE, sessionId, safeName(fileName));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const allLines = raw.split('\n');
    const tail = allLines.slice(Math.max(0, allLines.length - lines));
    const total = allLines.length;
    res.json({ lines: tail.length, total, content: tail.join('\n') });
  } catch { res.status(404).json({ error: 'File not found' }); }
});

/** Read a specific line range of an uploaded file */
app.post('/api/file/read', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, startLine = 1, endLine } = req.body;
  if (!sessionId || !fileName) return res.status(400).json({ error: 'Missing sessionId or fileName' });
  const fp = path.join(UPLOAD_BASE, sessionId, safeName(fileName));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const allLines = raw.split('\n');
    const end = endLine ? Math.min(endLine, allLines.length) : allLines.length;
    const slice = allLines.slice(Math.max(0, startLine - 1), end);
    const total = allLines.length;
    res.json({ startLine, endLine: end, lines: slice.length, total, content: slice.join('\n') });
  } catch { res.status(404).json({ error: 'File not found' }); }
});

/** Search/grep an uploaded file */
app.post('/api/file/grep', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, pattern, maxResults = 50, contextLines = 2 } = req.body;
  if (!sessionId || !fileName || !pattern) return res.status(400).json({ error: 'Missing sessionId, fileName, or pattern' });
  const fp = path.join(UPLOAD_BASE, sessionId, safeName(fileName));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const allLines = raw.split('\n');
    const regex = new RegExp(pattern, 'i');
    const results: { lineNumber: number; line: string; context: string }[] = [];
    for (let i = 0; i < allLines.length && results.length < maxResults; i++) {
      if (regex.test(allLines[i])) {
        const ctxStart = Math.max(0, i - contextLines);
        const ctxEnd = Math.min(allLines.length, i + contextLines + 1);
        results.push({
          lineNumber: i + 1,
          line: allLines[i],
          context: allLines.slice(ctxStart, ctxEnd).map((l, j) => `${ctxStart + j + 1}: ${l}`).join('\n'),
        });
      }
    }
    res.json({ matches: results.length, total: allLines.length, results });
  } catch { res.status(404).json({ error: 'File not found' }); }
});

/** Extract errors/anomalies from an uploaded log file */
app.post('/api/file/extract-errors', express.json(), async (req: any, res: any) => {
  const { sessionId, fileName, contextLines = 3, maxErrors = 30, includeWarnings } = req.body;
  if (!sessionId || !fileName) return res.status(400).json({ error: 'Missing sessionId or fileName' });
  const fp = path.join(UPLOAD_BASE, sessionId, safeName(fileName));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const { extractErrors } = await import('./log-analyzer.js');
    const result = extractErrors(raw, { contextLines, maxErrors, includeWarnings });
    res.json(result);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

/** Delete an uploaded file */
app.delete('/api/upload/:sessionId/:name', async (req: any, res: any) => {
  const filePath = path.join(UPLOAD_BASE, req.params.sessionId, safeName(req.params.name));
  try {
    await fs.unlink(filePath);
    res.json({ removed: true });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

const PORT = parseInt(process.env.PORT || '4747', 10);

app.use('/vendor', async (req, res, next) => {
  const filePath = path.join(vendorDir, req.path.replace(/^\//, ''));
  if (!filePath.startsWith(vendorDir)) return res.status(403).end();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const ct = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.type(ct).send(content);
  } catch { next(); }
});

async function sendQaPage(_req: any, res: any) {
  try {
    let content = await fs.readFile(qaIndexFile, 'utf-8');
    const QA_VARS = { bgSurface: 'var(--bg-component)', bgSecondary: 'var(--bg-secondary)', border: 'var(--color-border)', text: 'var(--color-text-primary)', textMuted: 'var(--color-text-secondary)', blue: 'var(--color-blue)' };
    const QA_IDS = { domainBar: 'qaDomainBar', domainInput: 'qaDomainInput', attachBtn: 'attachBtn', fileInput: 'fileInput', sendBtn: 'sendBtn', qaInput: 'qaInput', qaHighlight: 'qaHighlight', suggestDropdown: 'qaSuggestDropdown' };
    content = content.replace('/* QA_INPUT_CSS */', qaInputStyles(QA_VARS));
    content = content.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: QA_VARS, textarea: true, placeholder: '输入代码库相关问题...', idMap: QA_IDS, suggestApi: 'api/qa/questions/suggest' }));
    content = content.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: QA_VARS, textarea: true, idMap: QA_IDS, suggestApi: 'api/qa/questions/suggest' }));
    content = content.replace('/* USER_BAR_CSS */', userBarStyles({ text: 'var(--color-text-primary)', text2: 'var(--color-text-secondary)', text3: 'var(--color-text-secondary)', blue: 'var(--color-blue)', border: 'var(--color-border)', surface: 'var(--bg-surface)', tagBg: 'var(--bg-secondary)' }));
    content = content.replace('<!-- USER_BAR_HTML -->', userBarHtml());
    content = content.replace('/* USER_BAR_JS */', userBarInitScript());
    if (BASE_PATH) {
      content = content.replace('</head>', `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)}</script></head>`);
    }
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Q&A page not found');
  }
}

async function sendHomePage(_req: any, res: any) {
  try {
    let content = await fs.readFile(homeIndexFile, 'utf-8');
    const HOME_VARS = { bgSurface: 'var(--surface)', bgSecondary: 'var(--tag-bg)', border: 'var(--border)', text: 'var(--text)', textMuted: 'var(--text3)', blue: 'var(--blue)' };
    const HOME_IDS = { domainBar: 'homeDomainBar', domainInput: 'homeDomainInput', attachBtn: 'attachBtn', fileInput: 'fileInput', sendBtn: 'qaAskBtn', qaInput: 'qaInput', qaHighlight: 'homeHighlight', suggestDropdown: 'homeSuggestDropdown' };
    content = content.replace('/* QA_INPUT_CSS */', qaInputStyles(HOME_VARS));
    content = content.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: HOME_VARS, textarea: true, placeholder: '输入代码库相关问题...', idMap: HOME_IDS, suggestApi: 'api/qa/questions/suggest' }));
    content = content.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: HOME_VARS, textarea: true, idMap: HOME_IDS, suggestApi: 'api/qa/questions/suggest' }));
    content = content.replace('/* USER_BAR_CSS */', userBarStyles());
    content = content.replace('<!-- USER_BAR_HTML -->', userBarHtml());
    content = content.replace('/* USER_BAR_JS */', userBarInitScript());
    if (BASE_PATH) {
      content = content.replace('</head>', `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)}</script></head>`);
    }
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Home page not found');
  }
}

app.get('/qa', sendQaPage);
app.get('/qa/', sendQaPage);
app.get('/qa/*', sendQaPage);
app.get('/', sendHomePage);
app.get('/:repoName/qa', sendQaPage);

// ── 增量索引 + 多库路由 API ──

app.post('/api/reindex', express.json(), async (req, res) => {
  const { repo, full } = req.body || {};
  const registry = await loadRegistry();
  const entry = registry.find(r => r.name === repo || r.path === repo);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }
  try {
    const { execFileSync } = await import('child_process');
    const projectName = CbmBridge.repoPathToProjectName(entry.path);
    const mode = full ? 'full' : 'fast';
    execFileSync('codebase-memory-mcp', ['cli', 'index_repository', JSON.stringify({
      repo_path: entry.path,
      mode,
    })], { stdio: 'inherit', timeout: 600_000, cwd: entry.path });
    res.json({ ok: true, repo: entry.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function loadSavedConfig(): Promise<Record<string, string>> {
  const configDir = path.join(os.homedir(), '.opencodewiki');
  const configFile = path.join(configDir, 'config.json');
  try {
    await fs.access(configFile);
    const raw = await fs.readFile(configFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Read crossRepos scope from config. If set, cross-repo queries are limited to these repos. */
function loadCrossRepoScope(): string[] | undefined {
  try { return JSON.parse(fsSync.readFileSync(path.join(os.homedir(), '.opencodewiki', 'config.json'), 'utf-8')).crossRepos; } catch {}
  return undefined;
}

const resolveLLMConfig = async () => {
  const saved = await loadSavedConfig();
  return {
    apiKey: process.env.OPENAI_API_KEY || saved.apiKey || '',
    baseUrl: process.env.LLM_BASE_URL || saved.baseUrl || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || saved.model || 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.3,
    provider: saved.provider || 'openai',
  };
};

/**
 * 解析 search_graph 的 JSON 输出（兼容旧 markdown 格式）。
 * codebase-memory-mcp 返回 JSON，可直接解析。
 */
function parseSearchText(text: string): { filePath: string; startLine: number; endLine: number; name?: string }[] {
  // 如果是 JSON 格式（新 codebase-memory-mcp 输出）
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      if (data.results) {
        return data.results.map((r: any) => ({
          filePath: r.file_path || r.file || '',
          startLine: r.start_line || 1,
          endLine: r.end_line || r.start_line || 1,
          name: r.name || '',
        }));
      }
    } catch {}
  }

  // 兼容旧 markdown 格式（过渡期）
  const results: { filePath: string; startLine: number; endLine: number; name?: string }[] = [];
  const lines = text.split('\n');
  let currentName: string | undefined;
  for (const line of lines) {
    const headerMatch = line.match(/^###\s+(.+?)\s+\((\w+)\)\s*$/);
    if (headerMatch) {
      currentName = headerMatch[1];
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('##') && !trimmed.startsWith('*') && !trimmed.startsWith('Error') && !trimmed.startsWith('>') && !trimmed.startsWith('```')) {
      const lineNumMatch = trimmed.match(/^(.+?):(\d+)$/);
      if (lineNumMatch) {
        results.push({ filePath: lineNumMatch[1], startLine: parseInt(lineNumMatch[2], 10), endLine: parseInt(lineNumMatch[2], 10), name: currentName });
      } else if (trimmed.startsWith('/') || trimmed.startsWith('src/') || trimmed.startsWith('.')) {
        results.push({ filePath: trimmed, startLine: 1, endLine: 1, name: currentName });
      }
      currentName = undefined;
    }
  }
  return results;
}

function searchRepoPath(repoName?: string): string | undefined {
  if (!repoName) return undefined;
  const registry = loadRegistrySync();
  const repo = registry.find(r => r.name === repoName);
  // Self repo (path matches rootDir) or legacy opencodewiki — no projectPath needed
  if (!repo || repo.path === rootDir || repoName === 'opencodewiki') return undefined;
  return repo.path;
}

function loadRegistrySync(): RegistryEntry[] {
  try {
    return JSON.parse(fsSync.readFileSync(registryFile, 'utf-8'));
  } catch {
    return [];
  }
}

const search = async (query: string, repo?: string) => {
  try {
    const args: Record<string, unknown> = { query };
    const projectPath = searchRepoPath(repo);
    if (projectPath) args.projectPath = projectPath;
    const searchResult = await handler.execute('codegraph_search', args);
    const sources: any[] = [];
    if (searchResult?.content?.[0]?.text) {
      const results = parseSearchText(searchResult.content[0].text);
      for (const item of results) {
        sources.push({
          filePath: item.filePath,
          fileName: path.basename(item.filePath),
          startLine: item.startLine,
          endLine: item.endLine,
          snippet: '',
        });
      }
    }
    return { sources, flows: undefined };
  } catch {
    return { sources: [], flows: undefined };
  }
};

/** Run search_graph (trace_path inbound) for a symbol in a specific repo. */
const searchCallers = async (symbol: string, repo?: string) => {
  try {
    const projectName = repo ? CbmBridge.repoPathToProjectName(
      loadRegistrySync().find(r => r.name === repo)?.path || repo
    ) : CbmBridge.repoPathToProjectName(rootDir);
    const result = await handler.execute('trace_path', {
      function_name: symbol,
      direction: 'inbound',
      project: projectName,
    });
    const text = result?.content?.[0]?.text || '{}';
    const data = JSON.parse(text);
    if (data.callers?.length) {
      return data.callers.map((c: any) => `### ${c.name} (hop: ${c.hop})\n${c.qualified_name}`).join('\n');
    }
    return '';
  } catch { return ''; }
};

/** Run trace_path (both directions) for impact analysis of a symbol. */
const searchImpact = async (symbol: string, repo?: string) => {
  try {
    const projectName = repo ? CbmBridge.repoPathToProjectName(
      loadRegistrySync().find(r => r.name === repo)?.path || repo
    ) : CbmBridge.repoPathToProjectName(rootDir);
    const result = await handler.execute('trace_path', {
      function_name: symbol,
      direction: 'both',
      depth: 2,
      project: projectName,
    });
    const text = result?.content?.[0]?.text || '{}';
    const data = JSON.parse(text);
    const parts: string[] = [];
    if (data.callers?.length) {
      parts.push('Callers:\n' + data.callers.map((c: any) => `- ${c.name} (hop: ${c.hop})`).join('\n'));
    }
    if (data.callees?.length) {
      parts.push('Callees:\n' + data.callees.map((c: any) => `- ${c.name} (hop: ${c.hop})`).join('\n'));
    }
    return parts.join('\n\n');
  } catch { return ''; }
};

/** Resolve the "self" repo — the registry entry whose path matches rootDir. */
async function resolveSelfRepo(): Promise<{ storagePath: string; path: string; name: string }> {
  const registry = await loadRegistry();
  const self = registry.find(r => r.path === rootDir);
  const sp = self ? self.path : rootDir;
  return { storagePath: sp, path: sp, name: self ? self.name : 'opencodewiki' };
}

const resolveRepo = async (repoName?: string) => {
  if (!repoName) return resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = registry.find(r => r.name === repoName);
  if (entry) return { storagePath: entry.path, name: repoName };
  return { storagePath: path.join(rootDir, repoName), name: repoName };
};

const listRepos = async () => {
  const registry = await loadRegistry();
  // If self (rootDir) is not in registry, add it as synthetic entry
  const selfEntry = registry.find(r => r.path === rootDir);
  const results: { name: string; stats: { files: number; nodes: number; processes: number } }[] = [];
  if (!selfEntry) {
    results.push({ name: 'opencodewiki', stats: { ...await getCodegraphStatsFor(rootDir), processes: 0 } });
  }
  for (const entry of registry) {
    if (!results.find(r => r.name === entry.name)) {
      // Use cached stats from registry if available; otherwise query live
      let stats: { files: number; nodes: number; edges: number };
      if (entry.indexedAt && entry.files !== undefined) {
        stats = { files: entry.files, nodes: entry.nodes ?? 0, edges: entry.edges ?? 0 };
      } else {
        stats = await getCodegraphStatsFor(entry.path);
        // Persist stats to registry
        if (stats.files > 0) {
          entry.indexedAt = new Date().toISOString();
          entry.files = stats.files;
          entry.nodes = stats.nodes;
          entry.edges = stats.edges;
        }
      }
      // Backfill VCS detection for existing repos missing it
      if (!entry.vcs) {
        entry.vcs = detectVcs(entry.path);
        if (entry.vcs) await saveRegistry(registry);
      }
      results.push({ name: entry.name, stats: { files: stats.files, nodes: stats.nodes, processes: 0 } });
    }
  }
  return results;
};

app.get('/api/repos', async (_req, res) => {
  const repos = await listRepos();
  res.json(repos);
});

app.post('/api/repos', async (req, res) => {
  const { name, path: repoPath } = req.body;
  if (!name || !repoPath) { res.status(400).json({ error: 'Missing name or path' }); return; }
  const absPath = path.resolve(repoPath);
  const projectName = CbmBridge.repoPathToProjectName(absPath);
  // 验证索引是否存在（通过检测 index_status）
  try {
    const check = await handler.execute('index_status', { project: projectName });
    const text = check?.content?.[0]?.text || '{}';
    const data = JSON.parse(text);
    if (data.status !== 'ready' || !data.nodes) {
      res.status(400).json({ error: 'Repo not indexed. Run: codebase-memory-mcp cli index_repository \'{"repo_path":"' + absPath + '"}\'' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Repo not indexed or codebase-memory-mcp not available. Run: codebase-memory-mcp cli index_repository \'{"repo_path":"' + absPath + '"}\'' });
    return;
  }
  const registry = await loadRegistry();
  if (registry.find(r => r.name === name)) {
    res.status(409).json({ error: 'Repo "' + name + '" already registered' });
    return;
  }
  const vcs = detectVcs(absPath);
  const stats = await getCodegraphStatsFor(absPath);
  const entry: RegistryEntry = {
    name, path: absPath, vcs,
    indexedAt: stats.files > 0 ? new Date().toISOString() : undefined,
    files: stats.files, nodes: stats.nodes, edges: stats.edges,
  };
  registry.push(entry);
  await saveRegistry(registry);
  res.status(201).json({ ...entry });
});

app.delete('/api/repos/:name', async (req, res) => {
  const registry = await loadRegistry();
  const idx = registry.findIndex(r => r.name === req.params.name);
  if (idx === -1) { res.status(404).json({ error: 'Repo not found' }); return; }
  registry.splice(idx, 1);
  await saveRegistry(registry);
  res.json({ removed: true });
});

// ── Current user API ──
app.get('/api/me', (req, res) => {
  if (!(req as any).user) return res.json(null);
  res.json((req as any).user);
});

const qaHandler = createQaEndpoint(resolveRepo, resolveLLMConfig, search, listRepos, searchCallers, searchImpact, loadCrossRepoScope(), handler);
app.post('/api/qa', qaHandler);

app.get('/api/qa/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json({
    id: session.id, messages: session.messages, sources: session.sources,
    repo: session.repo, createdAt: session.createdAt, updatedAt: session.updatedAt,
  });
});

app.get('/api/qa/sessions/latest', (_req, res) => {
  res.json(listSessions('latest', 10));
});

app.get('/api/qa/sessions/frequent', (_req, res) => {
  res.json(listFrequentQuestions(3));
});

app.get('/api/qa/questions/suggest', (req, res) => {
  const q = (req.query.q as string || '').trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);
  if (q.length < 2) { res.json({ suggestions: [] }); return; }
  res.json({ suggestions: searchQuestions(q, limit) });
});

// ── #Q 问答沉淀体系 API ─────────────────────────────────────
const lightweightSearchHandler = createLightweightSearchHandler(search);
app.post('/api/qa/lightweight-search', lightweightSearchHandler);
app.use('/api/qa', qaRouter);

// ── Wiki API ──────────────────────────────────────────────

/** Trigger wiki generation for a repo. */
app.post('/api/wiki/generate', async (req, res) => {
  const { repoName } = req.body;
  if (!repoName) { res.status(400).json({ error: 'Missing repoName' }); return; }

  const selfRepo = await resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);

  if (!entry) { res.status(404).json({ error: `Repo "${repoName}" not found` }); return; }

  // Run codebase-memory-mcp wiki generation in background
  generateWiki(entry.path).then(result => {
    if (result.success) {
      console.log(`[wiki] ${repoName}: generated successfully`);
    } else {
      console.error(`[wiki] ${repoName} failed: ${result.error}`);
    }
  });

  res.json({ message: 'Wiki generation started' });
});

/** Get wiki info for a repo: module tree + overview content. */
app.get('/api/wiki/:repoName', async (req, res) => {
  const { repoName } = req.params;
  const selfRepo = await resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }

  const wikiDir = wikiOutputDir(entry.path);
  const tree = await loadModuleTree(wikiDir);

  res.json({ repoName: entry.name, tree });
});

/** Archive a calibrated #Q entry as a permanent wiki page. */
app.post('/api/wiki/archive', async (req, res) => {
  const { qid, notes } = req.body;
  if (!qid) { res.status(400).json({ error: 'Missing qid' }); return; }
  try {
    const qaStore = await import('./qa-store.js');
    const entry = qaStore.getEntryByQid(qid);
    if (!entry) { res.status(404).json({ error: `#Q${qid} not found` }); return; }
    const cal = qaStore.getCalibratedAnswer(entry.id);
    if (!cal) { res.status(400).json({ error: `#Q${qid} has no calibrated answer` }); return; }

    // Find which repo this entry belongs to
    const repoName = entry.repo;
    const selfRepo = await resolveSelfRepo();
    const registry = await loadRegistry();
    const repoEntry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);
    if (!repoEntry) { res.status(404).json({ error: 'Repo not found' }); return; }

    const repoPath = (repoEntry as any).storagePath || (repoEntry as any).path;
    const wikiDir = path.join(repoPath, '.codegraph', 'wiki', 'qa');
    await fs.mkdir(wikiDir, { recursive: true });

    // Generate markdown content
    const slug = `q${qid}-${entry.question.slice(0, 40).replace(/[^a-zA-Z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '')}`;
    const md = `---
title: "#Q${qid}: ${entry.question}"
archivedAt: "${new Date().toISOString()}"
qid: ${qid}
domain: ${entry.domain || 'general'}
calibratedAt: "${cal.updatedAt}"
calibrator: "${cal.calibrator || 'unknown'}"
version: ${cal.version}
---

# #Q${qid}: ${entry.question}

${cal.answer}

---

> 此页面由 #Q${qid} 的校准答案自动归档生成。
> [查看原始问答 →](/qa?qid=${qid})
`;

    const mdPath = path.join(wikiDir, `${slug}.md`);
    await fs.writeFile(mdPath, md, 'utf-8');

    // Update archive index
    const indexPath = path.join(wikiDir, 'index.json');
    let archiveIndex: any[] = [];
    try { archiveIndex = JSON.parse(await fs.readFile(indexPath, 'utf-8')); } catch {}
    // Remove existing entry for same qid if re-archiving
    archiveIndex = archiveIndex.filter((a: any) => a.qid !== qid);
    archiveIndex.unshift({ qid, slug, question: entry.question.slice(0, 100), domain: entry.domain, archivedAt: new Date().toISOString(), version: cal.version });
    await fs.writeFile(indexPath, JSON.stringify(archiveIndex, null, 2), 'utf-8');

    res.json({ success: true, slug });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** List archived wiki pages for a repo. */
app.get('/api/wiki/:repoName/archived', async (req, res) => {
  const repoName = req.params.repoName;
  const selfRepo = await resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }
  const repoPath2 = (entry as any).storagePath || (entry as any).path;
  const indexPath = path.join(repoPath2, '.codegraph', 'wiki', 'qa', 'index.json');
  try {
    const data = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    res.json({ entries: data });
  } catch {
    res.json({ entries: [] });
  }
});

/** Get a specific wiki page for a repo. Returns { page, content }. */
app.get('/api/wiki/:repoName/:page', async (req, res) => {
  const repoName = req.params.repoName;
  const page = req.params.page;
  const selfRepo = await resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }

  // Dynamic pages generated from codegraph / QA data
  if (DYNAMIC_WIKI_PAGES.includes(page)) {
    let content: string | null = null;
    switch (page) {
      case 'dependencies':
        content = await generateDependenciesPage(entry.path);
        break;
      case 'impact-map':
        content = await generateImpactMapPage(entry.path);
        break;
      case 'heatmap':
        content = await generateHeatmapPage(entry.path);
        break;
      case 'gotchas':
        content = await generateGotchasPage(entry.path, entry.name);
        break;
      case 'data-model':
        content = await generateDataModelPage(entry.path);
        break;
    }
    if (content) {
      res.json({ page, repoName: entry.name, content });
      return;
    }
  }

  const outputDir = wikiOutputDir(entry.path);
  const content = await readWikiPage(outputDir, page);
  if (content === null) { res.status(404).json({ error: `Wiki page "${page}" not found` }); return; }

  res.json({ page, repoName: entry.name, content });
});

const knownRepos = async () => {
  const self = await resolveSelfRepo();
  const reg = await loadRegistry();
  const names = reg.map(r => r.name);
  if (!names.includes(self.name)) names.unshift(self.name);
  return names;
};

async function sendWikiViewer(repoName: string, _req: any, res: any) {
  const selfRepo = await resolveSelfRepo();
  const reg = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : reg.find(r => r.name === repoName);
  if (!entry) { res.status(404).type('text').send('Repo not found'); return; }
  const repoPath = entry.path;
  const wikiDir = wikiOutputDir(repoPath);
  const tree = await loadModuleTree(wikiDir);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${repoName} &mdash; Wiki</title>
<script src="/vendor/marked.min.js"></script>
<script src="/vendor/mermaid.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#ffffff;--sidebar-bg:#f8f9fb;--border:#e5e7eb;--text:#1e293b;--text-muted:#64748b;--primary:#2563eb;--primary-soft:#eff6ff;--hover:#f1f5f9;--code-bg:#f1f5f9;--radius:8px;--shadow:0 1px 3px rgba(0,0,0,.08)}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.65;color:var(--text);background:var(--bg)}
.header{position:sticky;top:0;z-index:30;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 24px;display:flex;align-items:center;gap:10px}
.header-logo{display:flex;align-items:center;gap:6px;text-decoration:none;color:var(--primary);font-size:15px;font-weight:700}
.header-logo svg{flex-shrink:0}
.header-repo{font-size:10px;color:var(--text-muted);font-weight:500;padding:2px 6px;border-radius:4px;background:var(--hover)}
.layout{display:flex;min-height:100vh}
.sidebar{width:280px;background:var(--sidebar-bg);border-right:1px solid var(--border);position:fixed;top:41px;left:0;bottom:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;z-index:10}
.content{margin-left:280px;flex:1;padding:32px 64px;max-width:960px}
.nav-section{margin-bottom:2px}
.nav-item{display:block;padding:7px 12px;border-radius:var(--radius);cursor:pointer;font-size:13px;color:var(--text);text-decoration:none;transition:all .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-item:hover{background:var(--hover)}
.nav-item.active{background:var(--primary-soft);color:var(--primary);font-weight:600}
.nav-item.overview{font-weight:600;margin-bottom:4px}
.nav-divider{height:1px;background:var(--border);margin:8px 12px}
.content h1{font-size:28px;font-weight:700;margin-bottom:8px;line-height:1.3}
.content h2{font-size:22px;font-weight:600;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.content h3{font-size:17px;font-weight:600;margin:24px 0 8px}
.content h4{font-size:15px;font-weight:600;margin:20px 0 6px}
.content p{margin:12px 0}
.content ul,.content ol{margin:12px 0 12px 24px}
.content li{margin:4px 0}
.content a{color:var(--primary);text-decoration:none}
.content a:hover{text-decoration:underline}
.content blockquote{border-left:3px solid var(--primary);padding:8px 16px;margin:16px 0;background:var(--primary-soft);border-radius:0 var(--radius) var(--radius) 0;color:var(--text-muted);font-size:14px}
.content code{font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:13px;background:var(--code-bg);padding:2px 6px;border-radius:4px}
.content pre{background:#1e293b;color:#e2e8f0;border-radius:var(--radius);padding:16px;overflow-x:auto;margin:16px 0}
.content pre code{background:none;padding:0;font-size:13px;line-height:1.6;color:inherit}
.content table{border-collapse:collapse;width:100%;margin:16px 0}
.content th,.content td{border:1px solid var(--border);padding:8px 12px;text-align:left;font-size:14px}
.content th{background:var(--sidebar-bg);font-weight:600}
.content img{max-width:100%;border-radius:var(--radius)}
.content hr{border:none;border-top:1px solid var(--border);margin:32px 0}
.content .mermaid{margin:20px 0;text-align:center}
.menu-toggle{display:none;position:fixed;top:12px;left:12px;z-index:20;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;cursor:pointer;font-size:18px;box-shadow:var(--shadow)}
@media(max-width:768px){.sidebar{transform:translateX(-100%);transition:transform .2s}.sidebar.open{transform:translateX(0);box-shadow:2px 0 12px rgba(0,0,0,.1)}.content{margin-left:0;padding:24px 20px;padding-top:56px}.menu-toggle{display:block}}
.empty-state{text-align:center;padding:80px 20px;color:var(--text-muted)}
.empty-state h2{font-size:20px;margin-bottom:8px;border:none}
.qa-list{display:flex;flex-direction:column;gap:8px;margin-top:16px}
.qa-list-item{display:block;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius);text-decoration:none;color:var(--text);transition:all .15s}
.qa-list-item:hover{border-color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,.06)}.qa-archive-btn{display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--text-muted);margin-top:6px;transition:all .15s}.qa-archive-btn:hover{background:var(--primary);color:#fff;border-color:var(--primary)}
.qa-list-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.qa-list-qid{font-size:11px;font-weight:600;color:var(--primary)}
.qa-list-badge{font-size:10px;color:#16a34a;font-weight:500}
.qa-list-domain-badge{font-size:9px;font-weight:600;padding:1px 6px;border-radius:8px;border:1px solid var(--primary);color:var(--primary);background:var(--primary-soft);text-transform:capitalize;margin-right:3px}
.qa-list-question{font-size:14px;font-weight:500;line-height:1.4}
.qa-list-meta{font-size:11px;color:var(--text-muted);margin-top:4px}
.qa-entry{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:100%;max-width:680px;z-index:20;padding:0 16px}
/* QA_INPUT_CSS */
/* USER_BAR_CSS */
</style></head>
<body>

<button class="menu-toggle" id="menuToggle">&#9776;</button>
<div class="header">
  <a href="/" class="header-logo">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    OpenCodeWiki
  </a>
  <span class="header-repo">${repoName}</span>
  <!-- USER_BAR_HTML -->
</div>
<div class="layout">
<nav class="sidebar" id="sidebar">
  <div id="navTree"></div>
</nav>

<main class="content" id="content">
  <div class="empty-state"><h2>Loading...</h2></div>
</main>

</div>

<div class="qa-entry">
  <!-- QA_INPUT_HTML -->
</div>

<script>
(function() {
  var REPO = ${JSON.stringify(repoName)};
  var TREE = ${JSON.stringify(tree)};
  var activePage = 'overview';

  document.addEventListener('DOMContentLoaded', function() {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    /* QA_INPUT_JS */
    // Enter key / Ask button → redirect to QA (input is outside <form>)
    function redirectToQa() {
      var inp = document.getElementById('wikiQaInput');
      var q = inp.value.trim();
      if (!q) return;
      var dm = window.__qaSelectedDomain ? window.__qaSelectedDomain() : '';
      var params = new URLSearchParams({ q: q, repo: REPO });
      if (dm) params.set('domain', dm);
      location.href = '/qa?' + params.toString();
    }
    document.getElementById('wikiQaInput').addEventListener('keydown', function(e) {
      if (e.defaultPrevented) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); redirectToQa(); }
    });
    document.getElementById('wikiSendBtn').addEventListener('click', function(e) {
      e.preventDefault(); redirectToQa();
    });
    renderNav();
    loadArchivedEntries();
    document.getElementById('menuToggle').addEventListener('click', function() {
      document.getElementById('sidebar').classList.toggle('open');
    });
    if (location.hash && location.hash.length > 1) {
      activePage = decodeURIComponent(location.hash.slice(1));
    }
    navigateTo(activePage);
  });

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderNav() {
    var container = document.getElementById('navTree');
    var html = '';

    // ── 概览 / 对外API / 依赖图谱 ──
    html += '<div class="nav-section">';
    html += '<a class="nav-item" data-page="overview" href="#overview">📋 概览</a>';
    html += '<a class="nav-item" data-page="external-api" href="#external-api">🔄 对外API</a>';
    html += '<a class="nav-item" data-page="dependencies" href="#dependencies">🌐 依赖图谱</a>';
    html += '<a class="nav-item" data-page="data-model" href="#data-model">📐 数据结构</a>';
    html += '</div>';

    html += '<div class="nav-divider"></div>';

    // ── 💬 代码问答 ──
    html += '<div class="nav-group-label">💬 代码问答</div>';
    html += '<div class="nav-section">';
    html += '<a class="nav-item" data-page="qa-curated" href="#qa-curated">📚 精选问答</a>';
    html += '<a class="nav-item" data-page="qa-faq" href="#qa-faq">📋 常见问题</a>';
    html += '</div>';

    html += '<div class="nav-divider"></div>';

    // ── 📎 代码知识 ──
    html += '<div class="nav-group-label">📎 代码知识</div>';
    html += '<div class="nav-section">';
    html += '<a class="nav-item" data-page="gotchas" href="#gotchas">🔥 常见踩坑</a>';
    html += '<a class="nav-item" data-page="impact-map" href="#impact-map">🔗 影响地图</a>';
    html += '<a class="nav-item" data-page="heatmap" href="#heatmap">📊 代码热力图</a>';
    html += '<div class="nav-section" id="archiveNav" style="margin-top:4px">';
    html += '<div class="nav-item" style="color:var(--text-muted);font-size:12px">加载中...</div>';
    html += '</div>';
    html += '</div>';
    if (TREE.length > 0) {
      html += '<div class="nav-divider"></div>';
      html += '<div class="nav-group-label">📦 模块树</div>';
      html += '<div class="nav-section">';
      for (var i = 0; i < TREE.length; i++) {
        html += '<a class="nav-item" data-page="' + TREE[i].slug + '" href="#' + TREE[i].slug + '">' + TREE[i].name + '</a>';
      }
      html += '</div>';
    }
    container.innerHTML = html;
    container.addEventListener('click', function(e) {
      var target = e.target;
      while (target && !target.dataset.page) { target = target.parentElement; }
      if (target && target.dataset.page) {
        e.preventDefault();
        navigateTo(target.dataset.page);
      }
    });
  }

  function navigateTo(slug) {
    activePage = slug;
    document.querySelectorAll('.nav-item').forEach(function(a) { a.classList.remove('active'); });
    var match = document.querySelector('[data-page="' + slug + '"]');
    if (match) match.classList.add('active');
    history.replaceState(null, '', '#' + encodeURIComponent(slug));

    // Q&A list pages — fetch from #Q API, render inline
    if (slug === 'qa-curated' || slug === 'qa-faq') {
      renderQaList(slug);
      return;
    }

    var el = document.getElementById('content');
    el.innerHTML = '<div class="empty-state"><h2>Loading...</h2></div>';

    var url = 'api/wiki/' + encodeURIComponent(REPO) + '/' + encodeURIComponent(slug);

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (data.content) {
        el.innerHTML = marked.parse(data.content);
        // Convert mermaid code blocks into rendered diagrams
        el.querySelectorAll('pre code.language-mermaid').forEach(function(block) {
          var pre = block.parentElement;
          var div = document.createElement('div');
          div.className = 'mermaid';
          div.textContent = block.textContent;
          pre.parentElement.replaceChild(div, pre);
        });
        if (window.mermaid) mermaid.run({ nodes: el.querySelectorAll('.mermaid') });
      } else {
        el.innerHTML = '<div class="empty-state"><h2>Page not found</h2></div>';
      }
    }).catch(function() {
      el.innerHTML = '<div class="empty-state"><h2>Failed to load page</h2></div>';
    });
  }

  function renderQaList(pageType) {
    var el = document.getElementById('content');
    el.innerHTML = '<div class="empty-state"><h2>Loading...</h2></div>';

    var params = 'repo=' + encodeURIComponent(REPO) + '&sort=visit&limit=20';
    if (pageType === 'qa-curated') {
      params += '&calibrated=1';
    }
    var url = 'api/qa/entries?' + params;

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (!data.entries || data.entries.length === 0) {
        var emptyMsg = pageType === 'qa-curated' ? '暂无精选问答' : '暂无常见问题';
        el.innerHTML = '<div class="empty-state"><h2>' + emptyMsg + '</h2></div>';
        return;
      }
      var title = pageType === 'qa-curated' ? '📚 精选问答' : '📋 常见问题';
      var html = '<h1>' + title + '</h1>';
      html += '<div class="qa-list">';
      for (var i = 0; i < data.entries.length; i++) {
        var e = data.entries[i];
        var tag = e.mode === 'lightweight' ? '🔍' : '⚡';
        var cal = e.isCalibrated ? '<span class="qa-list-badge">✅ 标准答案</span>' : '';
        var q = escapeHtml(e.question);
        var DOMAIN_LABELS = { 'general':'通用','log-analysis':'日志分析','stack-analysis':'堆栈分析','bug-analysis':'缺陷分析','build-issue':'编译构建','program-analysis':'程序分析' };
        var domBadge = (e.domain && e.domain !== 'general') ? '<span class="qa-list-domain-badge">' + (DOMAIN_LABELS[e.domain] || e.domain) + '</span>' : '';
        var isCurated = pageType === 'qa-curated';
        html += '<div style="position:relative">';
        var entryLink = e.sessionId ? '/qa/' + encodeURIComponent(e.sessionId) : '/qa?qid=' + e.qid;
        html += '<a class="qa-list-item" href="' + entryLink + '">' +
          '<div class="qa-list-header">' +
          '  <span class="qa-list-qid">' + tag + ' #Q' + e.qid + '</span>' +
          '  ' + domBadge + cal +
          '</div>' +
          '<div class="qa-list-question">' + q + '</div>' +
          '<div class="qa-list-meta">' + formatDate(e.createdAt) + ' · ' + e.visitCount + ' 次访问</div>' +
          '</a>' +
          (isCurated ? '<button class="qa-archive-btn" onclick="event.stopPropagation();archiveQa(' + e.qid + ', this)">📦 归档到 Wiki</button>' : '') +
          '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }).catch(function() {
      el.innerHTML = '<div class="empty-state"><h2>加载失败</h2></div>';
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  function archiveQa(qid, btn) {
    btn.disabled = true;
    btn.textContent = '归档中...';
    fetch('api/wiki/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qid: qid }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) {
        btn.textContent = '✅ 已归档';
        btn.style.borderColor = '#16a34a';
        btn.style.color = '#16a34a';
        loadArchivedEntries(); // refresh sidebar
      } else {
        btn.textContent = '❌ ' + (data.error || '失败');
        btn.disabled = false;
      }
    }).catch(function() {
      btn.textContent = '❌ 网络错误';
      btn.disabled = false;
    });
  }

  function loadArchivedEntries() {
    var url = 'api/wiki/' + encodeURIComponent(REPO) + '/archived';
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (!data.entries || data.entries.length === 0) {
        document.getElementById('archiveNav').innerHTML = '<div class="nav-item" style="color:var(--text-muted);font-size:12px">暂无归档</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < data.entries.length; i++) {
        var e = data.entries[i];
        var q = escapeHtml(e.question.slice(0, 35));
        html += '<a class="nav-item" data-page="qa/' + e.slug + '" href="#qa/' + e.slug + '" title="' + escapeHtml(e.question) + '">📄 ' + q + '</a>';
      }
      document.getElementById('archiveNav').innerHTML = html;
    }).catch(function() {
      document.getElementById('archiveNav').innerHTML = '<div class="nav-item" style="color:var(--text-muted);font-size:12px">加载失败</div>';
    });
  }
})();
/* USER_BAR_JS */
</script>
</body></html>`;
  const WIKI_VARS = { bgSurface: 'var(--bg)', bgSecondary: 'var(--sidebar-bg)', border: 'var(--border)', text: 'var(--text)', textMuted: 'var(--text-muted)', blue: 'var(--primary)' };
  const WIKI_IDS = { domainBar: 'wikiDomainBar', domainInput: 'wikiDomainInput', attachBtn: 'wikiAttachBtn', fileInput: 'wikiFileInput', sendBtn: 'wikiSendBtn', qaInput: 'wikiQaInput', qaHighlight: 'wikiHighlight', typeInput: 'wikiQaType', suggestDropdown: 'wikiSuggestDropdown' };
  html = html.replace('/* QA_INPUT_CSS */', qaInputStyles(WIKI_VARS));
  html = html.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: WIKI_VARS, textarea: false, placeholder: 'Ask anything about this codebase...', repoName, idMap: WIKI_IDS, suggestApi: 'api/qa/questions/suggest' }));
  html = html.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: WIKI_VARS, textarea: false, idMap: WIKI_IDS, suggestApi: 'api/qa/questions/suggest' }));
  html = html.replace('/* USER_BAR_CSS */', userBarStyles({ text: 'var(--text)', text2: 'var(--text-muted)', text3: 'var(--text-muted)', blue: 'var(--primary)', border: 'var(--border)', surface: 'var(--bg)', tagBg: 'var(--sidebar-bg)' }));
  html = html.replace('<!-- USER_BAR_HTML -->', userBarHtml());
  html = html.replace('/* USER_BAR_JS */', userBarInitScript());
  res.type('html').send(html);
}

app.get('/:repoName', async (req, res, next) => {
  const names = await knownRepos();
  if (names.includes(req.params.repoName)) {
    await sendWikiViewer(req.params.repoName, req, res);
  } else {
    next();
  }
});

// BASE_PATH：通过 API 网关转发，优先环境变量，其次 config.json
// 设置后所有 API 挂载到该前缀下，如 /opencodewiki
// 启动时固定，不支持中途变更
let BASE_PATH = process.env.BASE_PATH || '';
if (!BASE_PATH) {
  try {
    const cfg = JSON.parse(fsSync.readFileSync(path.join(os.homedir(), '.opencodewiki', 'config.json'), 'utf-8'));
    BASE_PATH = cfg.basePath || '';
  } catch {}
}
if (BASE_PATH) {
  const wrapped = express();
  wrapped.use(BASE_PATH, app);
  wrapped.listen(PORT, () => {
    console.log(`OpenCodeWiki server running on http://localhost:${PORT}${BASE_PATH}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`OpenCodeWiki server running on http://localhost:${PORT}`);
  });
}
