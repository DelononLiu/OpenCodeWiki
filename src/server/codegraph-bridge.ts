import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createQaEndpoint, getSession, listSessions, listFrequentQuestions } from './qa-endpoint.js';
import {
  generateWiki, readWikiPage, readWikiIndex, listWikiPages, wikiOutputDir,
} from './wiki-integration.js';

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
  indexedAt: string;
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
    const content = await fs.readFile(qaIndexFile, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Q&A page not found');
  }
}

async function sendHomePage(_req: any, res: any) {
  try {
    const content = await fs.readFile(homeIndexFile, 'utf-8');
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
  if (!repoName || repoName === 'opencodewiki') return undefined;
  const registry = loadRegistrySync();
  return registry.find(r => r.name === repoName)?.path;
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

const resolveRepo = async (repoName?: string) => {
  if (!repoName) return { storagePath: path.join(rootDir, 'opencodewiki'), name: 'opencodewiki' };
  const registry = await loadRegistry();
  const entry = registry.find(r => r.name === repoName);
  if (entry) return { storagePath: path.join(entry.path, repoName), name: repoName };
  return { storagePath: path.join(rootDir, repoName), name: repoName };
};

const listRepos = async () => {
  const registry = await loadRegistry();
  const results = [{ name: 'opencodewiki', stats: await getCodegraphStatsFor(rootDir) }];
  for (const entry of registry) {
    if (!results.find(r => r.name === entry.name)) {
      const stats = await getCodegraphStatsFor(entry.path);
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
  const entry: RegistryEntry = { name, path: absPath, indexedAt: new Date().toISOString() };
  registry.push(entry);
  await saveRegistry(registry);
  const stats = await getCodegraphStatsFor(absPath);
  res.status(201).json({ ...entry, stats });
});

app.delete('/api/repos/:name', async (req, res) => {
  const registry = await loadRegistry();
  const idx = registry.findIndex(r => r.name === req.params.name);
  if (idx === -1) { res.status(404).json({ error: 'Repo not found' }); return; }
  registry.splice(idx, 1);
  await saveRegistry(registry);
  res.json({ removed: true });
});

const qaHandler = createQaEndpoint(resolveRepo, resolveLLMConfig, search, listRepos);
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

// ── Wiki API ──────────────────────────────────────────────

/** Trigger wiki generation for a repo. */
app.post('/api/wiki/generate', async (req, res) => {
  const { repoName, force } = req.body;
  if (!repoName) { res.status(400).json({ error: 'Missing repoName' }); return; }

  const registry = await loadRegistry();
  const entry = repoName === 'opencodewiki'
    ? { name: 'opencodewiki', path: rootDir }
    : registry.find(r => r.name === repoName);

  if (!entry) { res.status(404).json({ error: `Repo "${repoName}" not found` }); return; }

  const outputDir = wikiOutputDir(entry.path);

  // Run in background — respond immediately
  generateWiki(entry.path, outputDir, !!force).then(result => {
    if (result.success) {
      console.log(`[wiki] ${repoName}: ${result.total} pages (${result.generated} new, ${result.updated} updated)`);
    } else {
      console.error(`[wiki] ${repoName} failed: ${result.error}`);
    }
  });

  res.json({ message: 'Wiki generation started', outputDir });
});

/** Get wiki index for a repo. Returns { pages: string[], content: string }. */
app.get('/api/wiki/:repoName', async (req, res) => {
  const { repoName } = req.params;
  const registry = await loadRegistry();
  const entry = repoName === 'opencodewiki'
    ? { name: 'opencodewiki', path: rootDir }
    : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }

  const outputDir = wikiOutputDir(entry.path);
  const pages = await listWikiPages(outputDir);
  const content = await readWikiIndex(outputDir);

  res.json({
    repoName: entry.name,
    pages,
    content, // raw markdown, frontend renders with marked.js
  });
});

/** Get a specific wiki page for a repo. Returns { page, content }. */
app.get('/api/wiki/:repoName/:page', async (req, res) => {
  const repoName = req.params.repoName;
  const page = req.params.page;
  const registry = await loadRegistry();
  const entry = repoName === 'opencodewiki'
    ? { name: 'opencodewiki', path: rootDir }
    : registry.find(r => r.name === repoName);
  if (!entry) { res.status(404).json({ error: 'Repo not found' }); return; }

  const outputDir = wikiOutputDir(entry.path);
  const content = await readWikiPage(outputDir, page);
  if (content === null) { res.status(404).json({ error: `Wiki page "${page}" not found` }); return; }

  res.json({ page, repoName: entry.name, content });
});

const knownRepos = async () => {
  const reg = await loadRegistry();
  const names = reg.map(r => r.name);
  if (!names.includes('opencodewiki')) names.unshift('opencodewiki');
  return names;
};

async function sendWikiPage(repoName: string, _req: any, res: any) {
  const allRepos = await knownRepos();
  const repos = await listRepos();
  const repo = repos.find(r => r.name === repoName);
  if (!repo) { res.status(404).type('text').send('Repo "' + repoName + '" not found'); return; }
  const stats = repo.stats;
  const reg = await loadRegistry();
  const entry = reg.find(r => r.name === repoName);
  const repoPath = entry?.path || rootDir;
  const wikiDir = wikiOutputDir(repoPath);
  const wikiPages = await listWikiPages(wikiDir);
  const hasWiki = wikiPages.length > 0;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${repoName} — OpenCodeWiki</title>
<script src="/vendor/marked.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
body{background:#f5f5f7;color:#111}
.header{position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid #e5e7eb;padding:14px 24px;display:flex;align-items:center;gap:12px}
.header h1{font-size:16px;font-weight:600}
.header a{color:#007aff;text-decoration:none;font-size:14px;margin-left:auto}
.nav{display:flex;gap:0;border-bottom:1px solid #e5e7eb;background:#fff;padding:0 24px}
.nav a{padding:10px 18px;font-size:13px;color:#666;text-decoration:none;border-bottom:2px solid transparent;cursor:pointer}
.nav a.active{color:#007aff;border-bottom-color:#007aff}
.main{max-width:800px;margin:0 auto;padding:32px 24px 100px}
.stats{display:flex;gap:16px;margin:20px 0 32px}
.stat-box{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;flex:1;text-align:center}
.stat-box .num{font-size:24px;font-weight:700;color:#007aff}
.stat-box .label{font-size:12px;color:#888;margin-top:4px}
.repo-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
.repo-list a{padding:6px 14px;border-radius:20px;border:1px solid #e5e7eb;text-decoration:none;font-size:13px;color:#555;background:#fff}
.repo-list a.active{background:#007aff;color:#fff;border-color:#007aff}
.wiki-section{display:none;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;margin-top:20px}
.wiki-section.active{display:block}
.wiki-section h1,.wiki-section h2,.wiki-section h3{color:#111;margin:20px 0 10px}
.wiki-section h1:first-child,.wiki-section h2:first-child{margin-top:0}
.wiki-section h1{font-size:22px;border-bottom:1px solid #eee;padding-bottom:8px}
.wiki-section h2{font-size:17px}
.wiki-section h3{font-size:15px}
.wiki-section p{font-size:14px;line-height:1.7;color:#333;margin:8px 0}
.wiki-section a{color:#007aff;text-decoration:none}
.wiki-section a:hover{text-decoration:underline}
.wiki-section table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
.wiki-section th,.wiki-section td{border:1px solid #e5e7eb;padding:8px 12px;text-align:left}
.wiki-section th{background:#f9f9f9;font-weight:600}
.wiki-section code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:13px}
.wiki-section pre{background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;overflow-x:auto;margin:12px 0;font-size:13px;line-height:1.5}
.wiki-section pre code{background:inherit;color:inherit;padding:0;font-size:inherit}
.wiki-section ul,.wiki-section ol{padding-left:20px;margin:8px 0}
.wiki-section li{font-size:14px;line-height:1.7;color:#333}
.wiki-section blockquote{border-left:3px solid #007aff;padding:8px 16px;margin:12px 0;color:#666;background:#f9f9f9}
.wiki-loading{color:#888;font-size:14px;padding:20px 0;text-align:center}
.bottom-bar{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:100%;max-width:640px;z-index:20;padding:0 16px}
.input-box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:10px 16px;display:flex;align-items:flex-end;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.input-box:focus-within{border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.18)}
.input-box textarea{flex:1;border:none;outline:none;font-size:16px;resize:none;overflow:hidden;padding:3px 0;min-height:56px;line-height:1.6;font-family:inherit}
.input-box textarea::placeholder{color:#aaa}
.input-box button{padding:8px 22px;background:#007aff;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}
.input-box button:hover{opacity:.88}
.input-box textarea::-webkit-scrollbar{width:4px}
.input-box textarea::-webkit-scrollbar-thumb{background:#bbb;border-radius:2px}
.input-box textarea::-webkit-scrollbar-button{display:none}
</style></head>
<body>
<div class="header">
  <h1 style="color:#007aff;display:inline"><a href="/" style="color:inherit;text-decoration:none">OpenCodeWiki</a></h1>
  <span style="font-size:13px;color:#888">${repoName}</span>
  <a href="/qa?repo=${encodeURIComponent(repoName)}">Ask AI</a>
</div>
<div class="repo-list" style="padding:12px 24px 0">
  ${allRepos.map(n => '<a href="/' + encodeURIComponent(n) + '"' + (n === repoName ? ' class="active"' : '') + '>' + n + '</a>').join('')}
</div>
<div class="nav">
  <a class="active" onclick="showTab('stats',this)">Overview</a>
  ${hasWiki ? '<a onclick="showTab(\'wiki\',this)">Wiki</a>' : ''}
  ${hasWiki ? '<a onclick="showTab(\'wiki-index\',this)">Wiki Index</a>' : ''}
</div>
<div class="main">
  <!-- Stats tab -->
  <div id="tab-stats" class="active">
    <div class="stats">
      <div class="stat-box"><div class="num">${stats.files}</div><div class="label">Files</div></div>
      <div class="stat-box"><div class="num">${stats.nodes}</div><div class="label">Symbols</div></div>
      <div class="stat-box"><div class="num">${stats.edges ?? '-'}</div><div class="label">Relations</div></div>
    </div>
  </div>

  <!-- Wiki pages tab -->
  <div id="tab-wiki" class="wiki-section"></div>

  <!-- Wiki index tab -->
  <div id="tab-wiki-index" class="wiki-section"></div>
</div>
<div class="bottom-bar">
  <div class="input-box">
    <form action="/qa" method="get" style="display:flex;align-items:flex-end;gap:8px;width:100%">
      <input type="hidden" name="repo" value="${repoName}">
      <textarea name="q" placeholder="Ask about ${repoName}..." autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.submit()}"></textarea>
      <button type="submit">Ask</button>
    </form>
  </div>
</div>
<script>
const REPO = ${JSON.stringify(repoName)};

function showTab(name, el) {
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');

  // Load wiki content on first click
  if (name === 'wiki-index' && !tab.dataset.loaded) {
    tab.dataset.loaded = '1';
    tab.innerHTML = '<div class="wiki-loading">Loading wiki...</div>';
    fetch('/api/wiki/' + encodeURIComponent(REPO))
      .then(r => r.json())
      .then(data => {
        if (data.content) {
          tab.innerHTML = marked.parse(data.content);
        } else {
          tab.innerHTML = '<p style="color:#888;padding:20px;text-align:center">No wiki content available.</p>';
        }
      })
      .catch(() => { tab.innerHTML = '<p style="color:#888;padding:20px">Failed to load wiki.</p>'; });
  }
  if (name === 'wiki' && !tab.dataset.loaded) {
    tab.dataset.loaded = '1';
    loadWikiPageList();
  }
}

function loadWikiPageList() {
  const tab = document.getElementById('tab-wiki');
  tab.innerHTML = '<div class="wiki-loading">Loading wiki pages...</div>';
  fetch('/api/wiki/' + encodeURIComponent(REPO))
    .then(r => r.json())
    .then(data => {
      if (!data.pages || data.pages.length === 0) {
        tab.innerHTML = '<p style="color:#888;padding:20px;text-align:center">No wiki pages.</p>';
        return;
      }
      // Filter: remove index from the list, show page links
      const pages = data.pages.filter(p => p !== 'index');
      let html = '<h2>Wiki Pages</h2><ul>';
      pages.forEach(p => {
        html += '<li><a href="#" onclick="loadWikiPage(\\'' + p + '\\');return false">' + p.replace(/-/g, ' ') + '</a></li>';
      });
      html += '</ul><div id="wiki-page-content" style="margin-top:24px;border-top:1px solid #eee;padding-top:20px"></div>';
      tab.innerHTML = html;
    })
    .catch(() => { tab.innerHTML = '<p style="color:#888;padding:20px">Failed to load wiki pages.</p>'; });
}

function loadWikiPage(slug) {
  const container = document.getElementById('wiki-page-content');
  container.innerHTML = '<div class="wiki-loading">Loading...</div>';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  fetch('/api/wiki/' + encodeURIComponent(REPO) + '/' + encodeURIComponent(slug))
    .then(r => r.json())
    .then(data => {
      container.innerHTML = data.content ? marked.parse(data.content) : '<p>Page not found.</p>';
    })
    .catch(() => { container.innerHTML = '<p style="color:#888">Failed to load page.</p>'; });
}
</script>
</body></html>`;
  res.type('html').send(html);
}

app.get('/:repoName', async (req, res, next) => {
  const names = await knownRepos();
  if (names.includes(req.params.repoName)) {
    await sendWikiPage(req.params.repoName, req, res);
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`OpenCodeWiki server running on http://localhost:${PORT}`);
});
