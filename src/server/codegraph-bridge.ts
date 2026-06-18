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
import {
  generateWiki, readWikiPage, loadModuleTree, wikiOutputDir,
} from './wiki-integration.js';
import { setupAuth } from './auth/index.js';

// Codegraph is optional — the server can run without it (search/QA will be degraded)
let ToolHandler: any, CodeGraph: any;
try {
  const cgModule = await import('@colbymchenry/codegraph/dist/mcp/index.js');
  const cgCore = await import('@colbymchenry/codegraph');
  ToolHandler = cgModule.ToolHandler;
  CodeGraph = cgCore.CodeGraph;
} catch {
  console.warn('[codegraph] Codegraph engine not available — search/QA features will be limited');
  ToolHandler = null;
  CodeGraph = null;
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
    const result = await handler.execute('codegraph_status', { projectPath });
    const text = result?.content?.[0]?.text || '';
    const files = parseInt(text.match(/\*\*Files indexed:\*\*\s*(\d+)/)?.[1] || '0', 10);
    const nodes = parseInt(text.match(/\*\*Total nodes:\*\*\s*(\d+)/)?.[1] || '0', 10);
    const edges = parseInt(text.match(/\*\*Total edges:\*\*\s*(\d+)/)?.[1] || '0', 10);
    return { files, nodes, edges };
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

async function initHandler(): Promise<any> {
  if (!ToolHandler) {
    // Return a stub handler when codegraph is not installed
    return {
      execute: async (_method: string, _args?: any) => ({ content: [{ text: '' }] }),
    };
  }
  const codegraphDir = path.join(rootDir, '.codegraph');
  let cg: any = null;
  try {
    await fs.access(codegraphDir);
    cg = await CodeGraph.open(rootDir);
  } catch {
    try {
      cg = await CodeGraph.init(rootDir, { index: false });
    } catch {}
  }
  return new ToolHandler(cg);
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
    const QA_IDS = { domainBar: 'qaDomainBar', domainMoreBtn: 'qaDomainMoreBtn', domainMoreDropdown: 'qaDomainMoreDropdown', domainInput: 'qaDomainInput', attachBtn: 'attachBtn', fileInput: 'fileInput', sendBtn: 'sendBtn', qaInput: 'qaInput', suggestDropdown: 'qaSuggestDropdown' };
    content = content.replace('/* QA_INPUT_CSS */', qaInputStyles(QA_VARS));
    content = content.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: QA_VARS, textarea: true, placeholder: '输入代码库相关问题...', idMap: QA_IDS, suggestApi: '/api/qa/questions/suggest' }));
    content = content.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: QA_VARS, textarea: true, idMap: QA_IDS, suggestApi: '/api/qa/questions/suggest' }));
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Q&A page not found');
  }
}

async function sendHomePage(_req: any, res: any) {
  try {
    let content = await fs.readFile(homeIndexFile, 'utf-8');
    const HOME_VARS = { bgSurface: 'var(--surface)', bgSecondary: 'var(--tag-bg)', border: 'var(--border)', text: 'var(--text)', textMuted: 'var(--text3)', blue: 'var(--blue)' };
    const HOME_IDS = { domainBar: 'homeDomainBar', domainMoreBtn: 'homeDomainMoreBtn', domainMoreDropdown: 'homeDomainMoreDropdown', domainInput: 'homeDomainInput', attachBtn: 'attachBtn', fileInput: 'fileInput', sendBtn: 'qaAskBtn', qaInput: 'qaInput', suggestDropdown: 'homeSuggestDropdown' };
    content = content.replace('/* QA_INPUT_CSS */', qaInputStyles(HOME_VARS));
    content = content.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: HOME_VARS, textarea: true, placeholder: '输入代码库相关问题...', idMap: HOME_IDS, suggestApi: '/api/qa/questions/suggest' }));
    content = content.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: HOME_VARS, textarea: true, idMap: HOME_IDS, suggestApi: '/api/qa/questions/suggest' }));
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

const handler = await initHandler();

app.post('/api/search', async (req, res) => {
  const result = await handler.execute('codegraph_search', req.body);
  res.json(result);
});

app.post('/api/context', async (req, res) => {
  const result = await handler.execute('codegraph_context', req.body);
  res.json(result);
});

app.post('/api/impact', async (req, res) => {
  const result = await handler.execute('codegraph_impact', req.body);
  res.json(result);
});

app.get('/api/status', async (_req, res) => {
  const result = await handler.execute('codegraph_status', {});
  res.json(result);
});

app.post('/api/files', async (req, res) => {
  const result = await handler.execute('codegraph_files', req.body);
  res.json(result);
});

app.post('/api/callers', async (req, res) => {
  const result = await handler.execute('codegraph_callers', req.body);
  res.json(result);
});

app.post('/api/callees', async (req, res) => {
  const result = await handler.execute('codegraph_callees', req.body);
  res.json(result);
});

app.post('/api/node', async (req, res) => {
  const result = await handler.execute('codegraph_node', req.body);
  res.json(result);
});

app.post('/api/explore', async (req, res) => {
  const result = await handler.execute('codegraph_explore', req.body);
  res.json(result);
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

function parseSearchText(text: string): { filePath: string; startLine: number; endLine: number; name?: string }[] {
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

/** Run codegraph_callers for a symbol in a specific repo. */
const searchCallers = async (symbol: string, repo?: string) => {
  try {
    const args: Record<string, unknown> = { symbol, limit: 15 };
    const projectPath = searchRepoPath(repo);
    if (projectPath) args.projectPath = projectPath;
    const result = await handler.execute('codegraph_callers', args);
    return result?.content?.[0]?.text || '';
  } catch { return ''; }
};

/** Run codegraph_impact for a symbol in a specific repo. */
const searchImpact = async (symbol: string, repo?: string) => {
  try {
    const args: Record<string, unknown> = { symbol, depth: 2 };
    const projectPath = searchRepoPath(repo);
    if (projectPath) args.projectPath = projectPath;
    const result = await handler.execute('codegraph_impact', args);
    return result?.content?.[0]?.text || '';
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
  try {
    await fs.access(path.join(absPath, '.codegraph'));
  } catch {
    res.status(400).json({ error: 'No .codegraph directory found at ' + absPath + '. Run `npx codegraph init` first.' });
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

const qaHandler = createQaEndpoint(resolveRepo, resolveLLMConfig, search, listRepos, searchCallers, searchImpact, loadCrossRepoScope());
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

  // Run gitnexus wiki in background
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

/** Get a specific wiki page for a repo. Returns { page, content }. */
app.get('/api/wiki/:repoName/:page', async (req, res) => {
  const repoName = req.params.repoName;
  const page = req.params.page;
  const selfRepo = await resolveSelfRepo();
  const registry = await loadRegistry();
  const entry = repoName === selfRepo.name ? selfRepo : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }

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
.qa-list-item:hover{border-color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.qa-list-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.qa-list-qid{font-size:11px;font-weight:600;color:var(--primary)}
.qa-list-badge{font-size:10px;color:#16a34a;font-weight:500}
.qa-list-domain-badge{font-size:9px;font-weight:600;padding:1px 6px;border-radius:8px;border:1px solid var(--primary);color:var(--primary);background:var(--primary-soft);text-transform:capitalize;margin-right:3px}
.qa-list-question{font-size:14px;font-weight:500;line-height:1.4}
.qa-list-meta{font-size:11px;color:var(--text-muted);margin-top:4px}
.qa-entry{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:100%;max-width:680px;z-index:20;padding:0 16px}
/* QA_INPUT_CSS */
</style></head>
<body>

<button class="menu-toggle" id="menuToggle">&#9776;</button>
<div class="header">
  <a href="/" class="header-logo">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    OpenCodeWiki
  </a>
  <span class="header-repo">${repoName}</span>
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

    // ── 📖 Wiki ──
    html += '<div class="nav-group-label">📖 Wiki</div>';
    html += '<div class="nav-section">';
    html += '<a class="nav-item" data-page="overview" href="#overview">Overview</a>';
    html += '<a class="nav-item" data-page="external-api" href="#external-api">外部API</a>';
    html += '<a class="nav-item" data-page="core" href="#core">Core</a>';
    html += '<a class="nav-item" data-page="hot-modules" href="#hot-modules">热点模块</a>';
    html += '</div>';

    html += '<div class="nav-divider"></div>';

    // ── 💬 问答 ──
    html += '<div class="nav-group-label">💬 问答</div>';
    html += '<div class="nav-section">';
    html += '<a class="nav-item" data-page="qa-latest" href="#qa-latest">最新问答</a>';
    html += '<a class="nav-item" data-page="qa-hot" href="#qa-hot">最热问答</a>';
    html += '</div>';

    if (TREE.length > 0) {
      html += '<div class="nav-divider"></div>';
    }

    // ── 📦 模块 ──
    if (TREE.length > 0) {
      html += '<div class="nav-group-label">📦 模块</div>';
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
    if (slug === 'qa-latest' || slug === 'qa-hot') {
      renderQaList(slug === 'qa-hot' ? 'visit' : 'latest');
      return;
    }

    var el = document.getElementById('content');
    el.innerHTML = '<div class="empty-state"><h2>Loading...</h2></div>';

    var url = '/api/wiki/' + encodeURIComponent(REPO) + '/' + encodeURIComponent(slug);

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (data.content) {
        el.innerHTML = marked.parse(data.content);
        if (window.mermaid) mermaid.run({ nodes: el.querySelectorAll('.mermaid') });
      } else {
        el.innerHTML = '<div class="empty-state"><h2>Page not found</h2></div>';
      }
    }).catch(function() {
      el.innerHTML = '<div class="empty-state"><h2>Failed to load page</h2></div>';
    });
  }

  function renderQaList(sort) {
    var el = document.getElementById('content');
    el.innerHTML = '<div class="empty-state"><h2>Loading...</h2></div>';

    var url = '/api/qa/entries?repo=' + encodeURIComponent(REPO) + '&sort=' + sort + '&limit=20';

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (!data.entries || data.entries.length === 0) {
        el.innerHTML = '<div class="empty-state"><h2>' + (sort === 'latest' ? '暂无最新问答' : '暂无热门问答') + '</h2></div>';
        return;
      }
      var title = sort === 'latest' ? '最新问答' : '最热问答';
      var html = '<h1>' + title + '</h1>';
      html += '<div class="qa-list">';
      for (var i = 0; i < data.entries.length; i++) {
        var e = data.entries[i];
        var tag = e.mode === 'lightweight' ? '🔍' : '⚡';
        var cal = e.isCalibrated ? '<span class="qa-list-badge">✅ 标准答案</span>' : '';
        var q = escapeHtml(e.question);
        var DOMAIN_LABELS = { 'general':'通用','log-analysis':'日志分析','stack-analysis':'堆栈分析','bug-analysis':'缺陷分析','build-issue':'编译构建','program-analysis':'程序分析' };
        var domBadge = (e.domain && e.domain !== 'general') ? '<span class="qa-list-domain-badge">' + (DOMAIN_LABELS[e.domain] || e.domain) + '</span>' : '';
        html += '<a class="qa-list-item" href="/qa?' + encodeURIComponent(REPO) + '&qid=' + e.qid + '">' +
          '<div class="qa-list-header">' +
          '  <span class="qa-list-qid">' + tag + ' #Q' + e.qid + '</span>' +
          '  ' + domBadge + cal +
          '</div>' +
          '<div class="qa-list-question">' + q + '</div>' +
          '<div class="qa-list-meta">' + formatDate(e.createdAt) + ' · ' + e.visitCount + ' 次访问</div>' +
          '</a>';
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
})();
</script>
</body></html>`;
  const WIKI_VARS = { bgSurface: 'var(--bg)', bgSecondary: 'var(--sidebar-bg)', border: 'var(--border)', text: 'var(--text)', textMuted: 'var(--text-muted)', blue: 'var(--primary)' };
  const WIKI_IDS = { domainBar: 'wikiDomainBar', domainMoreBtn: 'wikiDomainMoreBtn', domainMoreDropdown: 'wikiDomainMoreDropdown', domainInput: 'wikiDomainInput', attachBtn: 'wikiAttachBtn', fileInput: 'wikiFileInput', sendBtn: 'wikiSendBtn', qaInput: 'wikiQaInput', typeInput: 'wikiQaType', suggestDropdown: 'wikiSuggestDropdown' };
  html = html.replace('/* QA_INPUT_CSS */', qaInputStyles(WIKI_VARS));
  html = html.replace('<!-- QA_INPUT_HTML -->', qaInputHtml({ vars: WIKI_VARS, textarea: false, placeholder: 'Ask anything about this codebase...', repoName, idMap: WIKI_IDS, suggestApi: '/api/qa/questions/suggest' }));
  html = html.replace('/* QA_INPUT_JS */', qaInputInitScript({ vars: WIKI_VARS, textarea: false, idMap: WIKI_IDS, suggestApi: '/api/qa/questions/suggest' }));
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

app.listen(PORT, () => {
  console.log(`OpenCodeWiki server running on http://localhost:${PORT}`);
});
