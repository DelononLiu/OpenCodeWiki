import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import type { ServerResponse } from 'http';
import { AcpClient, isAcpEnabled, isAcpCrossRoot } from './acp/AcpClient.js';
import type { AcpMessageHandler } from './acp/types.js';
import * as qaStore from './qa-store.js';
import type { Domain } from './qa-store.js';
import { QaResolver, classifyScopeRule } from './qa-resolver.js';
import type { IntentResult, PipelineMatch, RepoInfo } from './qa-resolver.js';

/** Sanitize filename to prevent path traversal */
function safeName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface QaMessage { role: string; content: string }
interface QaSession {
  id: string;
  messages: QaMessage[];
  sources: any[];
  repo?: string;
  acpSessionId?: string;
  qid?: number;
  mode?: 'lightweight' | 'deep';
  createdAt: string;
  updatedAt: string;
}

const sessions = new Map<string, QaSession>();

// 不自动清理 session—ChatGPT 模式，除非用户手动删除，否则永久保存
const SESSION_TTL_MS = Infinity;
const SESSION_MAX_AGE_MS = Infinity;
const MAX_SESSIONS_PER_REPO = 1000;
const CLEANUP_INTERVAL_MS = 0;

function getDataDir(): string {
  return process.env.OPENCODEWIKI_QA_DATA_DIR || path.join(os.homedir(), '.opencodewiki', 'qa-sessions');
}

function sessionFilePath(id: string): string {
  return path.join(getDataDir(), id + '.json');
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

function sessionToJson(s: QaSession): Record<string, unknown> {
  return { id: s.id, repo: s.repo, messages: s.messages, sources: s.sources, acpSessionId: s.acpSessionId, qid: s.qid, mode: s.mode, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

function sessionFromJson(data: Record<string, unknown>): QaSession {
  return {
    id: data.id as string,
    repo: data.repo as string | undefined,
    messages: (data.messages || []) as QaMessage[],
    sources: (data.sources || []) as any[],
    acpSessionId: data.acpSessionId as string | undefined,
    qid: data.qid as number | undefined,
    mode: data.mode as 'lightweight' | 'deep' | undefined,
    createdAt: data.createdAt as string,
    updatedAt: data.updatedAt as string,
  };
}

async function saveSession(session: QaSession): Promise<void> {
  try {
    const dir = getDataDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(sessionFilePath(session.id), JSON.stringify(sessionToJson(session)), 'utf-8');
  } catch (e) {
    log('error', 'failed to save session', { id: session.id, error: (e as Error)?.message });
  }
}

async function loadSessions(): Promise<void> {
  const dir = getDataDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const now = Date.now();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(dir, f), 'utf-8');
        const data = JSON.parse(content);
        const session = sessionFromJson(data);
        const age = now - new Date(session.updatedAt).getTime();
        if (age > SESSION_MAX_AGE_MS) {
          await fs.unlink(path.join(dir, f)).catch(() => {});
          continue;
        }
        sessions.set(session.id, session);
      } catch {}
    }
    log('info', 'loaded sessions', { count: sessions.size, dir });
  } catch (e) {
    log('warn', 'no sessions dir', { dir, error: (e as Error)?.message });
  }
}

async function cleanupStaleSessions(): Promise<void> {
  const now = Date.now();
  const dir = getDataDir();
  for (const [id, session] of sessions) {
    const age = now - new Date(session.updatedAt).getTime();
    if (age > SESSION_TTL_MS) {
      closeAcpSession(session);
      sessions.delete(id);
      try { await fs.unlink(sessionFilePath(id)); } catch {}
    }
  }
  // Remove orphaned disk files
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      if (!sessions.has(id)) {
        try { await fs.unlink(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

function closeAcpSession(session: QaSession): void {
  const repoName = session.repo;
  const acpSessionId = session.acpSessionId;
  if (!repoName || !acpSessionId) return;
  const client = repoClients.get(repoName);
  if (client) {
    client.closeSession(acpSessionId);
    const active = repoActiveSessions.get(repoName);
    if (active) active.delete(acpSessionId);
  }
  session.acpSessionId = undefined;
}

loadSessions();
// 清理已禁用 — session 永久保存，除非用户手动删除

export function getSession(id: string): QaSession | undefined {
  return sessions.get(id);
}

export interface QaSessionSummary {
  id: string;
  summary: string;
  messageCount: number;
  qid?: number;
  createdAt: string;
  updatedAt: string;
}

export function listSessions(sort: 'latest' | 'popular' = 'latest', limit = 10): QaSessionSummary[] {
  const list = Array.from(sessions.values());
  if (sort === 'popular') {
    list.sort((a, b) => b.messages.length - a.messages.length);
  } else {
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  return list.slice(0, limit).map(s => ({
    id: s.id,
    summary: s.messages.find(m => m.role === 'user')?.content?.slice(0, 80) || '(empty)',
    messageCount: s.messages.length,
    qid: s.qid,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

export interface QuestionSuggestion {
  question: string;
  sessionId: string;
  updatedAt: string;
}

export function searchQuestions(query: string, limit = 5): QuestionSuggestion[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const results: { question: string; sessionId: string; updatedAt: string; score: number }[] = [];
  const seen = new Set<string>();

  for (const session of sessions.values()) {
    const firstMsg = session.messages.find(m => m.role === 'user');
    if (!firstMsg) continue;
    const question = firstMsg.content.trim();
    if (!question || seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());

    const lower = question.toLowerCase();
    let score = 0;
    if (lower.startsWith(q)) {
      score = 100;
    } else if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(lower)) {
      score = 80;
    } else if (lower.includes(q)) {
      score = 60;
    }
    if (score === 0) continue;

    results.push({ question, sessionId: session.id, updatedAt: session.updatedAt, score });
  }

  results.sort((a, b) => b.score - a.score || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return results.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

export interface FrequentQuestion {
  question: string;
  count: number;
  lastAsked: string;
}

export function listFrequentQuestions(limit = 3): FrequentQuestion[] {
  const freq = new Map<string, { count: number; lastAsked: string }>();
  for (const session of sessions.values()) {
    const q = session.messages.find(m => m.role === 'user')?.content?.trim();
    if (!q) continue;
    const existing = freq.get(q);
    if (existing) {
      existing.count++;
      if (session.updatedAt > existing.lastAsked) existing.lastAsked = session.updatedAt;
    } else {
      freq.set(q, { count: 1, lastAsked: session.updatedAt });
    }
  }
  return Array.from(freq.entries())
    .map(([question, data]) => ({ question, count: data.count, lastAsked: data.lastAsked }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [qa] [' + level + '] ' + line);
}

// ACP enabled state is now resolved via isAcpEnabled() / isAcpCrossRoot() from AcpClient
// which reads from ~/.opencodewiki/config.json with env var override.
// Constants below are for convenience (no longer raw env vars).
const ACP_ENABLED = isAcpEnabled();
const ACP_CROSS_ROOT = isAcpCrossRoot();
const CROSS_REPO_ACP_CLIENT = '__cross__';

const repoClients = new Map<string, AcpClient>();
const repoActiveSessions = new Map<string, Set<string>>();

async function initRepoClient(repoName: string, repoBase: string): Promise<AcpClient | null> {
  const existing = repoClients.get(repoName);
  if (existing?.connected) return existing;

  const client = new AcpClient(repoBase);
  const ok = await client.connect();
  if (!ok) {
    log('error', 'ACP init failed', { repo: repoName, error: client.lastError });
    return null;
  }
  repoClients.set(repoName, client);
  repoActiveSessions.set(repoName, new Set());
  log('info', 'ACP repo client ready', { repo: repoName });
  return client;
}

function buildPrompt(
  question: string,
  systemPrompt: string,
  isFirstTurn: boolean,
): string {
  const parts: string[] = [];
  if (isFirstTurn) {
    parts.push('<system>\n' + systemPrompt + '\n</system>');
  }
  parts.push('<user>\n' + question + '\n</user>');
  return parts.join('\n\n');
}

async function acpPrompt(
  client: AcpClient,
  acpSessionId: string,
  question: string,
  systemPrompt: string,
  isFirstTurn: boolean,
  res: ServerResponse,
  sessionId: string,
): Promise<string> {
  const prompt = buildPrompt(question, systemPrompt, isFirstTurn);
  let content = '';

  const handler: AcpMessageHandler = {
    onText: (text: string) => {
      content += text;
      res.write('data: ' + JSON.stringify({ type: 'token', content: text }) + '\n\n');
    },
    onReasoning: (text: string) => {
      res.write('data: ' + JSON.stringify({ type: 'reasoning', content: text }) + '\n\n');
    },
    onToolCall: (toolCallId, title, kind, status) => {
      log('info', 'ACP', { sessionId, title, kind, status });
    },
    onToolCallUpdate: (toolCallId, status, content, title, kind) => {
      if (content) {
        log('info', 'ACP tool result', { toolCallId, status, len: content.length });
      }
    },
    onPlan: (entries) => {},
    onError: (error: string) => {
      res.write('data: ' + JSON.stringify({ type: 'error', message: error }) + '\n\n');
    },
    onDone: () => {},
  };

  await client.sendPrompt(acpSessionId, prompt, handler);
  return content;
}

const FILE_REF_RE = /([\w./-]+(?:\.[a-zA-Z][\w.-]*)):(\d+)(?:-(\d+))?/g;
const CROSS_REPO_FILE_REF_RE = /([\w-]+):([\w./-]+\.[a-zA-Z][\w.-]*):(\d+)(?:-(\d+))?/g;

function extractFileRefs(text: string): { fileName: string; filePath: string; startLine: number; endLine: number }[] {
  const refs: { fileName: string; filePath: string; startLine: number; endLine: number }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_REF_RE.lastIndex = 0;
  while ((m = FILE_REF_RE.exec(text)) !== null) {
    const filePath = m[1];
    const fileName = filePath.split('/').pop() || filePath;
    const startLine = parseInt(m[2], 10);
    const endLine = m[3] ? parseInt(m[3], 10) : startLine;
    const key = fileName + ':' + startLine;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ fileName, filePath, startLine, endLine });
    }
  }
  return refs;
}

async function findFileByBasename(dir: string, basename: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === basename) return fullPath;
      if (entry.isDirectory()) {
        const found = await findFileByBasename(fullPath, basename);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

async function resolveAnswerSources(
  content: string,
  existingSources: any[],
  repoBase: string | null,
  repoBases?: Map<string, string>,
): Promise<any[]> {
  if (repoBases) {
    return resolveCrossRepoSources(content, existingSources, repoBases);
  }
  const refs = extractFileRefs(content);
  if (!repoBase || refs.length === 0) return existingSources;

  const merged = [...existingSources];
  const existingKeys = new Set<string>();
  for (const s of existingSources) {
    const k = s.fileName + ':' + (s.startLine ?? '');
    existingKeys.add(k);
  }

  let refId = existingSources.length;
  for (const ref of refs) {
    const key = ref.fileName + ':' + ref.startLine;
    if (existingKeys.has(key)) continue;

    const candidatePaths = [
      path.join(repoBase, ref.filePath),
      path.join(repoBase, ref.fileName),
      path.join(repoBase, 'src', ref.fileName),
      path.join(repoBase, 'lib', ref.fileName),
    ];
    let snippet = '';
    let filePath = '';
    for (const cp of candidatePaths) {
      try {
        const stat = await fs.stat(cp);
        if (stat.isFile()) {
          filePath = cp;
          const srcContent = await fs.readFile(cp, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
          break;
        }
      } catch {}
    }
    if (!snippet) {
      const found = await findFileByBasename(repoBase, ref.fileName);
      if (found) {
        try {
          filePath = found;
          const srcContent = await fs.readFile(found, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
        } catch {}
      }
    }
    if (!snippet) continue;

    existingKeys.add(key);
    merged.push({
      filePath: filePath ? path.relative(repoBase, filePath) : ref.fileName,
      label: 'File',
      startLine: ref.startLine,
      endLine: ref.endLine,
      fileName: ref.fileName,
      snippet,
      refId: refId++,
    });
  }
  return merged;
}

async function resolveCrossRepoSources(
  content: string,
  existingSources: any[],
  repoBases: Map<string, string>,
): Promise<any[]> {
  const refs: { repoName: string; fileName: string; filePath: string; startLine: number; endLine: number }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const savedLastIndex = CROSS_REPO_FILE_REF_RE.lastIndex;
  CROSS_REPO_FILE_REF_RE.lastIndex = 0;
  // resolveCrossRepoSources start
  while ((m = CROSS_REPO_FILE_REF_RE.exec(content)) !== null) {
    const repoName = m[1];
    const filePath = m[2];
    const fileName = filePath.split('/').pop() || filePath;
    const startLine = parseInt(m[3], 10);
    const endLine = m[4] ? parseInt(m[4], 10) : startLine;
    const key = repoName + ':' + fileName + ':' + startLine;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ repoName, fileName, filePath, startLine, endLine });
    }
  }
  CROSS_REPO_FILE_REF_RE.lastIndex = savedLastIndex;
  log('info', 'resolveCrossRepoSources: refs extracted', { refCount: refs.length });

  if (refs.length === 0) {
    log('info', 'resolveCrossRepoSources: no refs in answer, check CROSS_REPO_FILE_REF_RE regex', { sample: content.slice(0, 200) });
    return existingSources;
  }

  const merged = [...existingSources];
  const existingKeys = new Set<string>();
  for (const s of existingSources) {
    const k = (s.repo ?? '') + ':' + s.fileName + ':' + (s.startLine ?? '');
    existingKeys.add(k);
  }

  let refId = existingSources.length;
  for (const ref of refs) {
    const key = ref.repoName + ':' + ref.fileName + ':' + ref.startLine;
    if (existingKeys.has(key)) continue;

    const repoBase = repoBases.get(ref.repoName);
    if (!repoBase) continue;

    const candidatePaths = [
      path.join(repoBase, ref.filePath),
      path.join(repoBase, ref.fileName),
      path.join(repoBase, 'src', ref.fileName),
      path.join(repoBase, 'lib', ref.fileName),
    ];
    let snippet = '';
    let filePath = '';
    for (const cp of candidatePaths) {
      try {
        const stat = await fs.stat(cp);
        if (stat.isFile()) {
          filePath = cp;
          const srcContent = await fs.readFile(cp, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
          break;
        }
      } catch {}
    }
    if (!snippet) {
      const found = await findFileByBasename(repoBase, ref.fileName);
      if (found) {
        try {
          filePath = found;
          const srcContent = await fs.readFile(found, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
        } catch {}
      }
    }
    if (!snippet) continue;

    existingKeys.add(key);
    merged.push({
      repo: ref.repoName,
      filePath: ref.repoName + ':' + (filePath ? path.relative(repoBase, filePath) : ref.fileName),
      label: 'File',
      startLine: ref.startLine,
      endLine: ref.endLine,
      fileName: ref.repoName + ':' + ref.fileName,
      snippet,
      refId: refId++,
    });
  }
  return merged;
}

// ── Domain classification ────────────────────────────────────────

export function classifyDomain(question: string): Domain {
  const q = question.trim().toLowerCase();
  // Build / compile issues
  if (/(编译|构建|构建失败|编译错误|build|compile|make\b|cmake|gradle|maven|bazel|link error|链接错误|依赖|dependency|链接|ld\b|ar\b|objdump|nm\b)/.test(q)) return 'build-issue';
  // Bug / defect analysis
  if (/(lint|eslint|sonar|tslint|prettier|代码质量|code smell|bug|缺陷|漏洞|格式检查|代码规范|规范检查|代码分析|循环复杂度|cyclomatic|复杂度|安全漏洞|安全分析)/.test(q)) return 'bug-analysis';
  // Stack trace / crash analysis
  if (/(堆栈|栈回溯|stack trace|call stack|segfault|段错误|null pointer|空指针|crash dump|core dump|异常退出|panic|crash|崩溃|OOM|内存泄漏|死锁|deadlock|线程|thread|并发|concurrent)/.test(q)) return 'stack-analysis';
  // Program analysis (runtime behavior, data flow, control flow)
  if (/(程序分析|数据流|控制流|data flow|control flow|program analysis|运行时|runtime behavior|调用链|调用图|call graph)/.test(q)) return 'program-analysis';
  // Log analysis
  if (/(日志|日志分析|异常日志|服务日志|access log|nginx log|application log|syslog|日志文件|log\b)/.test(q)) return 'log-analysis';
  return 'general';
}

/**
 * classifyQuestion() — backward compatible alias.
 */
export function classifyQuestion(question: string): Domain {
  return classifyDomain(question);
}

// ── Answer structure templates (LLM self-selects) ────────────────

function domainProcessingFlow(domain: Domain): string {
  const flows: Record<Domain, string> = {
    general: `## 领域处理流程

采用通用搜索策略：
1. search_graph 语义搜索定位问题相关的符号
2. get_code_snippet 获取关键符号的完整定义
3. 综合搜索到的信息组织回答`,

        'build-issue': `## 领域处理流程

这是一个 **编译构建** 问题，按以下方式处理：
1. **先确认是否真的是编译问题**：检查错误信息是否指向代码本身的语法/链接/配置问题
   - 如果是环境配置、版本不匹配、外部依赖问题，说明原因并给出修复方向
   - 如果是代码层面的编译错误，继续以下步骤
2. 提取错误信息中的关键标识符（函数名、宏、链接符号、目标名）
3. search_graph 搜索这些关键词，优先命中构建文件（CMakeLists.txt、Makefile、package.json、Cargo.toml 等）
4. get_code_snippet 查看关键符号的完整定义
5. 重点分析：编译选项配置、依赖版本约束、链接脚本、条件编译宏`,

    'bug-analysis': `## 领域处理流程

这是一个 **缺陷分析** 问题，按以下方式处理：
1. **先确认是否真的是缺陷**：阅读代码逻辑，判断用户描述的现象是否符合预期行为
   - 如果行为符合预期（设计如此、配置问题、用户误解），说明原因并结束
   - 如果确实不符合预期，继续以下步骤
2. 用问题中涉及的符号名进行 search_graph
3. get_code_snippet 获取函数/类的完整定义
4. 从以下维度审查代码：
   - 类型安全（类型转换、空指针、未初始化变量）
   - 资源管理（内存泄漏、句柄未释放）
   - 逻辑正确性（边界条件、竞态、空集合操作）
   - 可维护性（命名、复杂度、重复代码）
   - 安全漏洞（注入、越界、权限绕过）`,

        'stack-analysis': `## 领域处理流程

这是一个 **堆栈 / 崩溃分析** 问题，按以下方式处理：
1. **先确认崩溃是否由代码逻辑引起**：检查堆栈帧是否指向项目自有代码，排除第三方库/系统调用误报
   - 如果崩溃在第三方库或系统调用中且无项目代码参与，说明外部原因并结束
   - 如果指向项目代码，继续以下步骤
2. 从堆栈中提取关键帧的函数名——从应用程序代码层开始，过滤掉框架/库层
3. 用 search_graph 定位每个关键函数
4. 用 get_code_snippet 查看函数完整定义
5. 用 trace_path 追溯调用来源
6. 分析根因方向：空指针访问、缓冲区越界、未初始化变量、资源耗尽、断言失败`,

    'program-analysis': `## 领域处理流程

这是一个 **程序分析 / 运行时行为** 问题，按以下方式处理：
1. 用问题中的核心符号或概念进行 search_graph
2. get_code_snippet 获取关键定义
3. 用 trace_path 分析影响范围
4. 用 trace_path / trace_path 追踪调用链
5. 说明数据流转路径和关键控制节点`,

        'log-analysis': `## 领域处理流程

这是一个 **日志分析** 问题，按以下方式处理：
1. **先判断日志级别和性质**：区分是报错（error/fatal）还是警告/信息，确认是否需要关注
   - 如果是 INFO/WARN 级别的例行日志且无异常模式，说明无需处理并结束
   - 如果是 ERROR/FATAL 或明显异常模式，继续以下步骤
2. 提取日志中的关键信息：错误码、异常类型、时间戳、关键词
3. 用提取到的错误关键词进行 search_graph
4. 定位日志输出点附近的逻辑处理代码
5. 分析：什么条件下产生该日志、后续处理流程是什么、是否有已知的问题模式`,
  };
  return flows[domain] || flows.general;
}

function structureGuide(intent?: string, domain?: Domain): string {
  // 按意图 + 领域动态选择最合适的模板
  const tpl = selectTemplate(intent, domain);
  return `## 回答模板

请参考以下模板来组织回答。**答复的第一句话必须加粗，作为摘要。**

${tpl}`;
}

const TEMPLATES: Record<string, string> = {
  A: `### 模板 A：故障排查
适用于编译错误、运行时崩溃、段错误、日志异常、链接错误等排查类问题。

- **1 句话直接指出错误或异常（不加标题）。**
- ## 错误信息 — 关键错误输出放在代码块中；如有堆栈只需关键帧。
- ## 原因分析 — 用 bullet list 说明触发条件和根因，避免长篇大论。
- ## 解决方案 — 可操作的具体步骤，按推荐程度列出。`,

  B: `### 模板 B：代码解释
适用于"这段代码做了什么"、"这个函数功能是什么"、"逻辑是怎么走的"等解释类问题。

- **1 句话概括代码行为（不加标题）。**
- ## 功能说明 — 用自然语言解释作用，说明输入/输出/核心逻辑。
- ## 源码走读 — 沿关键路径逐段分析，配合代码片段标注行号。
- ## 影响范围 — 调用方/被调用方/边界情况/副作用。`,

  C: `### 模板 C：代码审查
适用于"这样写有什么问题"、"有优化空间吗"、"哪里可能出 bug"等审查类问题。

- **1 句话指出问题或改进点（不加标题）。**
- ## 问题分析 — 按正确性/性能/可维护性/安全维度分析，解释为什么是问题。
- ## 代码位置 — 文件:行号，涉及多处分别列出。
- ## 改进建议 — 最好有 before/after 对比，多方案时简述 trade-off。`,

  D: `### 模板 D：配置用法
适用于"这个配置项什么意思"、"API 怎么调"、"参数怎么设"等用法类问题。

- **1 句话说明配置或用法的目标（不加标题）。**
- ## 步骤 — numbered list 列出操作顺序。
- ## 参数说明 — 表格：参数名 | 类型 | 默认值 | 说明，只列关键参数。
- ## 示例 — 完整配置或调用示例（代码块），必要时加注释。`,

  E: `### 模板 E：模块分析
适用于"整体架构是什么"、"模块间怎么交互"、"数据流怎么走"等设计类问题。

- **1 句话概括整体设计（不加标题）。**
- ## 结构设计 — 优先使用 mermaid 图，说明分层或核心组件。
- ## 核心流程 — 关键数据流或调用链，说明数据流转和关键节点。
- ## 模块关系 — 依赖关系或通信方式，跨边界时注意接口约定。`,

  F: `### 模板 F：代码定位
适用于"XX 实现在哪"、"定义在哪里"、"入口在哪"等定位类问题。

- **1 句话给出核心位置（文件:行号，不加标题）。**
- ## 核心入口 — 文件:行号 + 函数签名，说明功能。
- ## 内部结构 — 关键子函数/结构体的文件路径和行号，说明职责。
- ## 调用链 — 从入口到核心逻辑的调用路径。`,
};

function selectTemplate(intent?: string, domain?: string): string {
  // intent + domain → 模板映射
  const map: Record<string, string> = {
    'what-is_general': 'B',
    'where-is_general': 'F',
    'how-to_general': 'D',
    'why-error_general': 'A',
    'what-structure_general': 'E',
    'what-impact_general': 'E',
    'why-error_stack-analysis': 'A',
    'why-error_build-issue': 'A',
    'why-error_bug-analysis': 'C',
    'what-is_bug-analysis': 'C',
    'log-analysis': 'A',
  };
  const key = intent && domain ? `${intent}_${domain}` : `${domain || 'general'}`;
  const selected = map[key] || map[`${intent}_general`] || map[domain || ''] || 'B';
  return TEMPLATES[selected] || TEMPLATES.B;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function buildSearchQuery(question: string, translation: string): string {
  return question + ' ' + translation;
}

async function translateToEnglish(question: string, llmConfig: any): Promise<string> {
  try {
    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: 'Bearer ' + llmConfig.apiKey };
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: 'Translate Chinese to English search keywords for code. Keep English names unchanged. Return ONLY keywords.' },
          { role: 'user', content: question },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}

export function createQaEndpoint(
  resolveRepo: (repoName?: string) => Promise<{ storagePath: string; name: string } | undefined>,
  resolveLLMConfig: () => Promise<{
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    provider?: string;
  }>,
  search: (query: string, repo?: string) => Promise<{ sources: any[]; flows?: string }>,
  listRepos?: () => Promise<{ name: string }[]>,
  searchCallers?: (symbol: string, repo?: string) => Promise<string>,
  searchImpact?: (symbol: string, repo?: string) => Promise<string>,
  crossRepoScope?: string[],  // if set, cross-repo queries are limited to these repo names
  handler?: any,  // codegraph handler — enables pipeline mode
) {
  // Eager init: pre-start ACP clients for all indexed repos
  if (ACP_ENABLED && listRepos) {
    listRepos().then(repos => {
      for (const repo of repos) {
        resolveRepo(repo.name).then(entry => {
          if (entry) {
            const repoBase = entry.storagePath;
            initRepoClient(repo.name, repoBase);
          }
        });
      }
    });
  }

  return async (req: any, res: any) => {
    let question = req.body?.question?.trim();
    const history: { role: string; content: string }[] = req.body?.history ?? [];
    const repoName = req.body?.repo ?? (req.query?.repo as string | undefined);
    let sessionId: string | undefined = req.body?.sessionId;
    const attachedFiles: { fileName: string; size: number }[] = req.body?.attachedFiles ?? [];
    const reqDomain: string | undefined = req.body?.domain;
    const questionType: string | undefined = req.body?.questionType;

    if (!question) {
      res.status(400).json({ error: 'Missing "question" in request body' });
      return;
    }

    log('info', '【Q】' + (repoName ?? '(全部)') + ': ' + question.slice(0, 60));

    let session = sessionId ? sessions.get(sessionId) : undefined;
    let qid: number | undefined;
    const qRefRe = /#Q(\d+)/g;
      let calibratedContext = '';

    if (!session) {
      // Use the client-provided sessionId if it looks like a valid ID,
      // so pre-uploaded files (stored under that sessionId) are found.
      // Only generate a new one if no sessionId was provided at all.
      const newId = (sessionId && typeof sessionId === 'string' && sessionId.length >= 8)
        ? sessionId
        : generateSessionId();
      sessionId = newId;
      session = { id: sessionId, messages: [], sources: [], repo: repoName, mode: 'deep', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      sessions.set(sessionId, session);
      saveSession(session);

      // Detect #Q references in the question
      const qRefs: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = qRefRe.exec(question)) !== null) {
        qRefs.push(parseInt(m[1], 10));
      }

      // Create #Q entry for this session (one #Q per session)
      try {
        const entry = qaStore.createEntry({
          sessionId,
          repo: repoName || '',
          question,
          mode: 'deep',
          sources: [],
          relatedQids: qRefs.length > 0 ? qRefs : undefined,
        });
        qid = entry.qid;
        session.qid = qid;
        saveSession(session);

        // Bidirectional link for each #Q reference
        for (const refQid of qRefs) {
          try {
            qaStore.linkEntries(refQid, qid);
          } catch {}
        }
      } catch (e) {
        log('error', 'failed to create #Q entry', { error: (e as Error)?.message });
      }

      // Fetch calibrated answers for referenced #Q entries
      if (qRefs.length > 0) {
        const calParts: string[] = [];
        for (const refQid of qRefs) {
          try {
            const refEntry = qaStore.getEntryByQid(refQid);
            if (refEntry) {
              const cal = qaStore.getCalibratedAnswer(refEntry.id);
              if (cal) {
                calParts.push('#Q' + refQid + ': ' + refEntry.question + '\n标准答案（版本 ' + cal.version + '）: ' + cal.answer.slice(0, 2000));
              }
            }
          } catch {}
        }
        if (calParts.length > 0) {
          calibratedContext = '\n\n## 引用的历史已校准问答\n以下 #Q 条目已被团队校准过，请参考其标准答案：\n\n' + calParts.join('\n\n');
        }
      }
    } else {
      // Follow-up question: reuse session's existing #Q, no new entry
      qid = session.qid;
    }

    // Cross-repo mode detection and scope filtering
    // @cross forces cross-repo search; @repoName targets a specific repo
    const hasCrossTag = /@cross\b/i.test(question);
    const repoAtMatch = question.match(/@(\w[\w-]*)\b/);
    const explicitRepo = repoAtMatch && repoAtMatch[1] !== 'cross' ? repoAtMatch[1] : undefined;
    const isCrossRepo = !!listRepos && (hasCrossTag || !repoName || !!explicitRepo);

    // Resolve cross-repo search scope
    let crossRepoNames: string[] | undefined;
    if (explicitRepo) {
      // @repoName: search only that repo
      crossRepoNames = [explicitRepo];
      question = question.replace(new RegExp('@' + explicitRepo + '\\b\\s*', 'gi'), '');
    } else if (crossRepoScope && crossRepoScope.length > 0) {
      // Config scope: limit cross-repo to configured repos
      crossRepoNames = crossRepoScope;
    }

    // Strip @cross tag
    if (hasCrossTag) question = question.replace(/@cross\b\s*/gi, '');
    let wikiContext = '';
    let entry = undefined;
    if (isCrossRepo) {
      const allRepos = await listRepos!();
      log('info', 'cross-repo mode', { repoCount: allRepos.length, names: allRepos.map(r => r.name) });

      // 如果不是 @cross 显式指定，用 classifyScopeRule 判断范围
      if (!hasCrossTag && !explicitRepo && allRepos.length > 1) {
        const scopeResult = classifyScopeRule(question, allRepos.map(r => r.name));
        log('info', '  ▸ scope', { scope: scopeResult.scope, repos: scopeResult.repos.length, note: scopeResult.reasoning?.slice(0, 40) });

        if (scopeResult.scope === 'single' && scopeResult.repos.length > 0) {
          // 单库问题 → 只搜匹配到的仓库
          crossRepoNames = scopeResult.repos;
        }
        // cross-compare → 只搜问题中提到的仓库
        if (scopeResult.scope === 'cross-compare' && scopeResult.repos.length > 0) {
          crossRepoNames = scopeResult.repos;
        }
        // cross-call / global-search → 保持全量并行搜（已有逻辑）
        // impact → 只搜目标仓库
        if (scopeResult.scope === 'impact' && scopeResult.repos.length > 0) {
          crossRepoNames = scopeResult.repos;
        }
      }
    } else {
      entry = await resolveRepo(repoName);
      if (entry) {
        // Read wiki overview from .codegraph/wiki/ (generated by codegraph)
        const wikiDir = path.join(entry.storagePath, '.codegraph', 'wiki');
        try {
          wikiContext = await fs.readFile(path.join(wikiDir, 'overview.md'), 'utf-8');
        } catch {
          try {
            wikiContext = await fs.readFile(path.join(wikiDir, 'index.md'), 'utf-8');
          } catch {}
        }
      }
    }

    let llmConfig: any = undefined;
    try {
      llmConfig = await resolveLLMConfig();
    } catch {}
    const hasLLM = !!llmConfig?.apiKey;

    if (!ACP_ENABLED && !hasLLM) {
      res.status(500).json({
        error: 'Failed to resolve LLM configuration. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json',
      });
      return;
    }

    // For Chinese questions, append an English translation to help BM25 and
    // the English-only embedding model match code. One search, dual language.
    let searchQuery = question;
    if (hasChinese(question) && hasLLM) {
      const en = await translateToEnglish(question, llmConfig);
      if (en) searchQuery = buildSearchQuery(question, en);
    }

    let sources: any[] = [];
    let searchContent = '';
    let crossImpactContent = '';
    let flowsText = '';
    let repoBaseMap: Map<string, string> | undefined = undefined;
    try {
      if (isCrossRepo) {
        let allRepos = await listRepos!();
        // Apply cross-repo scope filter if configured
        if (crossRepoNames) {
          allRepos = allRepos.filter(r => crossRepoNames!.includes(r.name));
        }
        log('info', '  ▸ cross-repo', { repos: allRepos.length, scope: crossRepoNames || 'all' });
        repoBaseMap = new Map();
        const allRepoResults: { repoName: string; sources: any[]; flows?: string }[] = [];
        await Promise.allSettled(allRepos.map(async (r) => {
          try {
            const repoEntry = await resolveRepo(r.name);
            if (!repoEntry) { log('warn', 'cross-repo search: repo not resolved', { repo: r.name }); return; }
            repoBaseMap!.set(r.name, repoEntry.storagePath);
            const result = await search(searchQuery, r.name);
            if (!result || !result.sources?.length) {
              // no results for repo
              return;
            }
            log('info', '  ▸ search', { repo: r.name, count: result.sources.length, files: (result.sources || []).slice(0, 3).map((s: any) => s.filePath?.split('/').pop()).join(', ') });
            allRepoResults.push({ repoName: r.name, sources: result.sources, flows: result.flows });
          } catch (repoErr) {
            log('error', 'cross-repo search failed for repo', { repo: r.name, error: (repoErr as Error)?.message });
          }
        }));
        const crossSources: any[] = [];
        for (const r of allRepoResults) {
          for (const s of r.sources.slice(0, 3)) {
            crossSources.push({
              ...s,
              repo: r.repoName,
              filePath: r.repoName + ':' + s.filePath,
              fileName: r.repoName + ':' + (s.fileName ?? s.filePath?.split('/').pop() ?? '?'),
              refId: crossSources.length,
              rawPath: s.filePath,
            });
          }
          if (r.flows) flowsText += r.flows + '\n';
        }

        // Populate snippets for cross-repo sources
        for (const src of crossSources) {
          if (src.snippet) continue;
          const baseDir = repoBaseMap.get(src.repo);
          if (!baseDir || !src.rawPath) continue;
          try {
            const fullPath = path.join(baseDir, src.rawPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const start = src.startLine ? Math.max(0, src.startLine - 2) : 0;
            const end = src.endLine && src.endLine !== src.startLine
              ? Math.min(lines.length, src.endLine + 2)
              : Math.min(lines.length, start + 20);
            if (start < lines.length) {
              src.snippet = lines.slice(start, end).map((l: string, i: number) =>
                (start + i + 1) + ': ' + l).join('\n');
            }
          } catch {}
        }

        sources = crossSources.slice(0, 10);
        log('info', '  ▸ search', { repos: allRepoResults.length, sources: sources.length });
        const lines: string[] = [];
        for (const s of sources) {
          lines.push((s.label ?? 'File') + ': ' + s.fileName + ' — ' + s.filePath + (s.startLine ? ':' + s.startLine : ''));
          if (s.snippet) {
            lines.push('```\n' + s.snippet + '\n```');
          }
        }
        searchContent = lines.join('\n');

        // Cross-repo impact: for repos with search hits, run callers + impact analysis
        if (hasCrossTag && searchCallers && allRepoResults.length > 0) {
          const hitRepos = allRepoResults.map(r => r.repoName);
          // Extract top symbol from first repo's results
          const topSymbol = allRepoResults[0]?.sources?.[0]?.name
            || allRepoResults[0]?.sources?.[0]?.filePath?.split('/').pop()?.replace(/\.[^.]+$/, '')
            || searchQuery.split(' ')[0];
          log('info', 'cross-repo impact starting', { repos: hitRepos.slice(0, 3), symbol: topSymbol });

          const impactParts: string[] = [];
          await Promise.allSettled(hitRepos.slice(0, 3).map(async (repo) => {
            try {
              const [callers, impact] = await Promise.all([
                searchCallers(topSymbol, repo),
                searchImpact!(topSymbol, repo),
              ]);
              if (callers) impactParts.push(`### ${repo}:callers\n${callers.slice(0, 2000)}`);
              if (impact) impactParts.push(`### ${repo}:impact\n${impact.slice(0, 2000)}`);
            } catch {}
          }));

          if (impactParts.length > 0) {
            crossImpactContent = '## CROSS-REPO IMPACT\n' + impactParts.join('\n\n');
            log('info', 'cross-repo impact done', { parts: impactParts.length });
          }
        }
      } else {
        const { sources: searchResults, flows: rawFlows = '' } = await search(searchQuery, repoName);
        flowsText = rawFlows;
        if (searchResults.length > 0) {
          const repoBase = entry ? entry.storagePath : null;
          const topResults = searchResults.slice(0, 5);
          const lines: string[] = [];
          for (const r of topResults) {
            lines.push((r.label ?? 'File') + ': ' + (r.name ?? r.filePath?.split('/').pop() ?? '?') +
              ' — ' + r.filePath + (r.startLine ? ':' + r.startLine : ''));
            const refId = sources.length;
            const sourceEntry: any = {
              filePath: r.filePath,
              label: r.label ?? 'File',
              startLine: r.startLine,
              endLine: r.endLine,
              fileName: r.filePath?.split('/').pop() ?? '?',
              snippet: '',
              refId,
            };
            if (repoBase && r.filePath) {
              const srcPath = path.join(repoBase, r.filePath);
              try {
                const srcContent = await fs.readFile(srcPath, 'utf-8');
                const srcLines = srcContent.split('\n');
                const start = r.startLine ? Math.max(0, r.startLine - 2) : 0;
                const end = r.endLine ? Math.min(srcLines.length, r.endLine + 2) : Math.min(srcLines.length, start + 20);
                const snippet = srcLines.slice(start, end).map((l: string, i: number) =>
                  (start + i + 1) + ': ' + l).join('\n');
                lines.push('```\n' + snippet + '\n```');
                sourceEntry.snippet = snippet;
              } catch {}
            }
            sources.push(sourceEntry);
          }
          searchContent = lines.join('\n');
        }
      }
    } catch (e) {
      log('error', 'search failed', { error: (e as Error)?.message });
    }

    // Load relevant Wiki module pages for single-repo QA
    let wikiModuleContext = '';
    if (!isCrossRepo && entry && sources.length > 0) {
      try {
        const wikiDir = path.join(entry.storagePath, '.codegraph', 'wiki');
        const moduleTreePath = path.join(wikiDir, 'module_tree.json');
        await fs.access(moduleTreePath); // throws if not exist
        const treeRaw = await fs.readFile(moduleTreePath, 'utf-8');
        const tree = JSON.parse(treeRaw);
        // Map source files to modules
        const matchedSlugs = new Set<string>();
        for (const src of sources) {
          const fp = src.rawPath || src.filePath || '';
          for (const mod of tree) {
            if (mod.files && mod.files.some((f: string) => fp.includes(f) || f.includes(fp))) {
              matchedSlugs.add(mod.slug);
            }
          }
        }
        // Load wiki pages for top 2 matched modules
        let loadedCount = 0;
        for (const slug of matchedSlugs) {
          if (loadedCount >= 2) break;
          try {
            const mdPath = path.join(wikiDir, slug + '.md');
            const content = await fs.readFile(mdPath, 'utf-8');
            wikiModuleContext += '\n### ' + slug + '\n' + content.slice(0, 2000) + '\n';
            loadedCount++;
          } catch {}
        }
      } catch {}
    }

    // ── Pipeline: Intent Analysis + codegraph 工具编排 ──────────
    let pipelineContext = '';
    let pipelineIntent: string | undefined;
    if (handler) {
      try {
        const resolver = new QaResolver(
          (tool: string, args: any) => handler.execute(tool, args),
        );

        // 注入向量搜索（由 cbm-bridge.ts 先设置全局变量）
        const vs = (globalThis as any).__vectorStore;
        if (vs) resolver.setVectorSearch(vs);
        if (llmConfig?.apiKey) resolver.setLLMConfig({ apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model });

        // Step 1: 意图分析（带仓库信息，让 LLM 同时判断 scope）
        const allRepoList = listRepos ? (await listRepos()).map(r => r.name) : [];
        // 取上一轮 Q&A 作为意图分类的上下文
        const lastHistory = session.messages.length >= 2
          ? session.messages.slice(-2).map((m: any) => `${m.role}: ${(m.content || '').slice(0, 200)}`).join('\n')
          : undefined;
        const intentResult = await resolver.analyzeIntent(question, allRepoList, lastHistory);
        pipelineIntent = intentResult.intent;
        log('info', '  ▸ intent', { intent: intentResult.intent, scope: intentResult.reasoning?.includes('scope:') ? intentResult.reasoning.split('scope:')[1] : '-', terms: intentResult.searchTerms.slice(0, 5) });

        // Step 2: 构建 repo 列表
        const repos: RepoInfo[] = [];
        if (isCrossRepo && repoBaseMap) {
          for (const [name, storagePath] of repoBaseMap) {
            repos.push({ name, storagePath });
          }
        } else if (entry) {
          repos.push({ name: entry.name || repoName || 'default', storagePath: entry.storagePath });
        }

        // Step 3: 按意图编排 codegraph 工具链
        const mode: 'llm' | 'acp' = ACP_ENABLED ? 'acp' : 'llm';
        const matches = await resolver.search(intentResult, repos, mode);
        log('info', '  ▸ search', { matches: matches.length });

        // Step 4: 构建上下文 (LLM 模式完整注入, ACP 模式精简线索)
        pipelineContext = mode === 'llm'
          ? resolver.buildLLMContext(matches, intentResult)
          : resolver.buildACPContext(matches, intentResult);
        if (pipelineContext) {
          log('info', 'pipeline context', { len: pipelineContext.length, mode });
        }

        // 用 pipeline 精筛结果替换 sources（只展示第二轮精选文件，不含第一轮噪声）
        const refinedSources = resolver.getRefinedSources();
        const sourceMatches = refinedSources.length > 0 ? refinedSources : matches;
        if (sourceMatches.length > 0) {
          // 按文件聚合，保留有 snippet 的那条，过滤 .kilo/ 副本
          const fileBest = new Map<string, typeof sourceMatches[0]>();
          for (const m of sourceMatches) {
            if (m.filePath.includes('/.kilo/')) continue;
            const existing = fileBest.get(m.filePath);
            const hasGoodSnippet = m.snippet && !m.snippet.includes('ambiguous') && m.snippet !== '{}' && m.snippet.length <= 500;
            if (!existing || (hasGoodSnippet && !existing.snippet)) {
              fileBest.set(m.filePath, m);
            }
          }
          sources = [...fileBest.entries()].map(([path, m], i) => {
            let snippet = m.snippet || '';
            if (snippet.includes('ambiguous') || snippet === '{}' || snippet.length > 500) snippet = '';
            // snippet 为空时回退读磁盘文件补预览
            if (!snippet && entry?.storagePath && path) {
              try {
                const fullPath = path.join(entry.storagePath, path);
                const content = fsSync.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                const start = Math.max(0, (m.startLine || 1) - 2);
                const end = Math.min(lines.length, (m.endLine || m.startLine || 1) + 2);
                snippet = lines.slice(start, end).map((l, j) => `${start + j + 1}: ${l}`).join('\n');
              } catch {}
            }
            if (!snippet) return null; // 没预览不展示
            return {
              filePath: path,
              label: m.kind === 'definition' ? 'Definition' : m.kind === 'declaration' ? 'Declaration' : 'Reference',
              startLine: m.startLine,
              endLine: m.endLine,
              fileName: path?.split('/').pop() ?? '?',
              snippet,
              refId: i,
            };
          }).filter(Boolean);
        }
      } catch (pipelineErr) {
        log('warn', 'pipeline error (non-fatal)', { error: (pipelineErr as Error)?.message });
      }
    }

    log('info', '【✓】完成', { intent: pipelineIntent, sources: sources.length });

    // ── 搜不到时走 LLM 引导用户补充信息 ──
    if (!ACP_ENABLED && handler && !pipelineContext && hasLLM) {
      log('info', '  ▸ no results, LLM guides user');
      pipelineContext = '## NOTE\n未在代码库中搜索到与问题相关的内容。请告知用户未找到相关代码，并引导用户提供更具体的信息（如函数名、错误信息、文件路径等）以便进一步定位。';
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write('data: ' + JSON.stringify({ type: 'session', id: sessionId }) + '\n\n');
    if (qid) {
      res.write('data: ' + JSON.stringify({ type: 'qid', qid }) + '\n\n');
    }
    log('info', '  ▸ stream', { sources: sources.length });
    res.write('data: ' + JSON.stringify({ type: 'sources', sources }) + '\n\n');

    session.messages.push({ role: 'user', content: question });
    session.updatedAt = new Date().toISOString();
    saveSession(session);

    // Resolve domain: explicit > backward-compat questionType > auto-classify
    const VALID_DOMAINS: Domain[] = ['general', 'log-analysis', 'stack-analysis', 'bug-analysis', 'build-issue', 'program-analysis'];
    let domain: Domain = 'general';
    if (reqDomain && VALID_DOMAINS.includes(reqDomain as Domain)) {
      domain = reqDomain as Domain;
    } else if (questionType && VALID_DOMAINS.includes(questionType as Domain)) {
      domain = questionType as Domain;
    } else {
      domain = classifyDomain(question);
    }
    const structure = structureGuide(pipelineIntent, domain);
    const domainFlow = domainProcessingFlow(domain);
    log('info', 'template selected', { intent: pipelineIntent, domain, template: structure.slice(0, 40) });

    // Persist domain to #Q entry
    if (qid) {
      try {
        qaStore.updateEntry(qid, { domain });
      } catch {}
    }

    const sourceRefs = sources.map(s =>
      s.filePath + (s.startLine ? ':' + s.startLine + (s.endLine && s.endLine !== s.startLine ? '-' + s.endLine : '') : '')
    ).join('\n- ');

    // ── Uploaded Files Context ──────────────────────────────────
    // Files stored at ~/.opencodewiki/uploads/<sessionId>/.
    // Auto-extracted on upload — read cached .analysis.json.
    // NEVER send raw file content — large files overflow context.
    const stagingId = sessionId || 'staging';
    const uploadBase = path.join(os.homedir(), '.opencodewiki', 'uploads', stagingId);
    let uploadedContext = '';
    if (attachedFiles.length > 0) {
      const fragments: string[] = [];
      for (const f of attachedFiles) {
        const cachePath = path.join(uploadBase, `.${f.fileName}.analysis.json`);
        const filePath = path.join(uploadBase, safeName(f.fileName));
        try {
          const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8'));

          if (cached._type === 'source') {
            // Source code file — show metadata + symbol list
            const sizeStr = f.size > 1024 * 1024
              ? (f.size / 1024 / 1024).toFixed(1) + 'MB'
              : (f.size / 1024).toFixed(0) + 'KB';
            fragments.push(
              `📄 ${f.fileName} (${sizeStr}, ${cached.total} lines)\n` +
              `Path: ${filePath}\n` +
              (cached._symbols ? `Symbols: ${cached._symbols}\n` : '') +
              `> Read this file via \`fs/read_text_file\` using the path above if needed.`
            );
            log('info', 'uploaded source file', { fileName: f.fileName, lines: cached.total, symbols: cached._symbols?.split(',').length || 0 });
          } else {
            // Log/text file — show error analysis
            const { buildErrorPromptFragment } = await import('./log-analyzer.js');
            fragments.push(buildErrorPromptFragment(f.fileName, cached, 90));
            log('info', 'uploaded log analysis (cached)', { fileName: f.fileName, extracted: cached.extracted, total: cached.total });
          }
        } catch {
          // Fallback: no cached analysis — inject basic metadata anyway
          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const totalLines = raw.split('\n').length;
            const sizeStr = f.size > 1024 * 1024
              ? (f.size / 1024 / 1024).toFixed(1) + 'MB'
              : (f.size / 1024).toFixed(0) + 'KB';
            fragments.push(
              `📄 ${f.fileName} (${sizeStr}, ${totalLines} lines)\n` +
              `Path: ${filePath}\n` +
              `> No auto-analysis available. Read via \`fs/read_text_file\` if needed.`
            );
            log('info', 'uploaded file (no cache, basic info)', { fileName: f.fileName, lines: totalLines });
          } catch {
            log('warn', 'uploaded file not found', { fileName: f.fileName });
          }
        }
      }
      if (fragments.length > 0) {
        uploadedContext = '\n## USER UPLOADED FILES\n' +
          'The user attached the following files:\n\n' +
          fragments.join('\n\n') + '\n';
      }
    }

    const systemPrompt = 'You are opencodewiki, a code analyst. Answer the question in DeepWiki style.\n\n' +
      '## RULES\n' +
      '- Always answer in Chinese.\n' +
      '- Use mermaid diagrams for architecture flows when relevant.\n' +
      '- Use code blocks for commands or examples.\n' +
      '- Keep paragraphs short (2-4 sentences).\n' +
      '- Do not restate the question.\n' +
      '- If unsure, say so.\n' +
      '- 禁止写文件，所有内容直接输出。\n' +
      '- 禁止使用 Explore Task。\n' +
      '- **回答输出格式必须严格遵循下方 ## 回答模板 中的一种模板（A/B/C/D/E），不允许自由发挥。**\n' +
      '- **问题相关信息搜索链路：search_graph（语义搜索符号）→ get_code_snippet（源码片段分析）→ trace_path（调用链追溯）→ grep（纯文本 fallback/提取）**\n' +
      '- 每个回答最多包含 6 个引用。如果没有搜到相关内容，请如实说「未搜到相关代码」，不要编造文件路径。\n' +
      (!ACP_ENABLED ? '- **引用必须使用下方 SEARCH CONTEXT 中列出的精确路径，禁止编造不存在的文件路径。**\n' : '') +
      (isCrossRepo
        ? '- 引用格式：在句子末尾用 (repoName:relative/path/file.ts:line)，如 (repoName:relative/path/file.ts:42)\n'
        : '- 引用格式：在句子末尾用 (relative/path/file.ts:line)，如 "该函数接收两个参数 (repoName/src/core/search.ts:175)"\n') +
      '- 范围引用用 (path:start-end)，如 (schema.ts:4-9)\n' +
      '- **重要：每个括号内只放一个文件+一个范围，绝对禁止逗号分隔多个范围。** 错误示例：(file.ts:1,5,10) 或 (file.ts:1-3,5-8)。如果要引用多个范围，请分开成多个括号引用。\n' +
      (isCrossRepo
        ? '- 引用文件路径使用 仓库名+相对路径 格式，如 repoName:src/server/file.ts:60。**绝对禁止只写文件名**\n'
        : '- 引用文件路径使用相对路径，如 repoName/src/core/file.ts:60。**绝对禁止只写文件名**，错误示例：bm25-index.ts:60。引用必须紧贴句子末尾，不要插在句子中间。\n') +
      '> 引用不要用反引号包裹！错误示例：\`(file.ts:1)\`。正确：(file.ts:1)。\n\n' +
      '- **重要：引用中的 repoName 必须来自下方 PIPELINE ANALYSIS / SEARCH CONTEXT 中列出的实际仓库名，不要使用示例中的 repoName 占位符。**\n' +
      (isCrossRepo ?
      '- **跨仓库模式：引用必须包含仓库名！** 格式为 (repoName:path/file.ts:line)，如 (repoName:relative/path/file.ts:42)\n' +
      '- 每个引用都必须标注来源仓库，绝对禁止省略 repoName。\n' +
      '- 回答可以覆盖多个仓库，每个引用要准确标注来自哪个仓库。\n'
      : '') +
      '\n' + domainFlow + '\n\n' +
      structure + '\n\n' +
      (uploadedContext ? uploadedContext + '\n' : '') +
      (pipelineContext ? pipelineContext + '\n\n---\n注意：以上是 PIPELINE 分析结果，你的引用必须来自上述文件路径。\n\n' :
      !ACP_ENABLED ? '## SEARCH CONTEXT\n' +
      '以下是搜索到的代码文件，你的引用必须来自此列表：\n\n' +
      '- ' + sourceRefs + (flowsText ? '\n\n### Execution Flows\n' + flowsText.slice(0, 2000) : '') + '\n\n' +
      '---\n' +
      '注意：回答时必须遵守上方 RULES 中的引用格式。引用路径必须是 SEARCH CONTEXT 中列出的精确路径。\n' : '') +
      (crossImpactContent ? '\n' + crossImpactContent + '\n' : '');

    if (ACP_ENABLED) {
      let acpRepoName: string | undefined;
      let acpRepoBase: string | undefined;

      if (isCrossRepo && repoBaseMap && repoBaseMap.size > 0) {
        if (ACP_CROSS_ROOT) {
          acpRepoName = CROSS_REPO_ACP_CLIENT;
          const firstBase = [...repoBaseMap.values()][0];
          acpRepoBase = path.dirname(firstBase);
          log('info', 'ACP cross-repo using parent dir', { name: acpRepoName, base: acpRepoBase });
        } else {
          acpRepoName = [...repoBaseMap.keys()][0];
          acpRepoBase = repoBaseMap.get(acpRepoName);
        }
      } else {
        acpRepoName = entry?.name;
        acpRepoBase = entry ? entry.storagePath : undefined;
      }

      let acpSessionId = session.acpSessionId;

      if (acpRepoName) {
        let client = repoClients.get(acpRepoName);
        if (!client) {
          client = await initRepoClient(acpRepoName, acpRepoBase ?? '.');
        }

        if (client) {
          // Max session check
          const activeSessions = repoActiveSessions.get(acpRepoName);
          if (activeSessions && activeSessions.size >= MAX_SESSIONS_PER_REPO) {
            res.write('data: ' + JSON.stringify({ type: 'error', message: 'Too many active sessions, please try again later' }) + '\n\n');
            res.end();
            return;
          }

          // Create ACP session if this QA session doesn't have one yet
          if (!acpSessionId) {
            acpSessionId = await client.createSession();
            if (acpSessionId) {
              session.acpSessionId = acpSessionId;
              activeSessions?.add(acpSessionId);
              saveSession(session);
            }
          }

          if (acpSessionId) {
            let aborted = false;
            req.on('close', () => { aborted = true; client.cancel(acpSessionId!); });

            try {
              const isFirstTurn = session.messages.length <= 1;
              const content = await acpPrompt(client, acpSessionId, question, systemPrompt, isFirstTurn, res, sessionId);
              if (content && !aborted) {
                session.messages.push({ role: 'assistant', content });
                session.updatedAt = new Date().toISOString();
                const repoBase = entry ? entry.storagePath : null;
                const resolvedSources = await resolveAnswerSources(content, sources, repoBase, repoBaseMap);
                const finalSources = resolvedSources.length > sources.length ? resolvedSources : sources;
                session.sources = finalSources;
                saveSession(session);
                if (resolvedSources.length > sources.length) {
                  res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
                }

                // Update #Q entry with answer
                if (qid) {
                  try {
                    qaStore.updateEntry(qid, { answer: content });
                  } catch (e) {
                    log('error', 'failed to update #Q entry', { error: (e as Error)?.message });
                  }
                }
              }
              res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
              res.end();
            } catch (err: any) {
              if (!aborted) {
                log('error', 'ACP prompt failed', { error: err.message });
                res.write('data: ' + JSON.stringify({ type: 'error', message: err.message ?? 'ACP request failed' }) + '\n\n');
                res.end();
              }
            }
            return;
          }
        }
      }
      log('warn', 'ACP not available, falling back to LLM', { hasLLM });
    }

    if (!hasLLM) {
      res.write('data: ' + JSON.stringify({ type: 'error', message: 'No LLM or ACP backend available' }) + '\n\n');
      res.end();
      return;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...session.messages.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders: Record<string, string> =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: 'Bearer ' + llmConfig.apiKey };

    const reqBody: Record<string, unknown> = {
      model: llmConfig.model,
      messages,
      stream: true,
      max_completion_tokens: llmConfig.maxTokens ?? 16384,
    };
    if (llmConfig.temperature !== undefined) {
      reqBody.temperature = llmConfig.temperature;
    }

    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'LLM API error: ' + errText.slice(0, 500) }) + '\n\n');
        res.end();
        return;
      }

      if (!response.body) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'LLM returned no response body' }) + '\n\n');
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        if (aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              res.write('data: ' + JSON.stringify({ type: 'token', content: delta }) + '\n\n');
            }
          } catch {}
        }
      }

      if (assistantContent) {
        session.messages.push({ role: 'assistant', content: assistantContent });
        session.updatedAt = new Date().toISOString();
        const repoBase = entry ? entry.storagePath : null;
        const resolvedSources = await resolveAnswerSources(assistantContent, sources, repoBase, repoBaseMap);
        const finalSources = resolvedSources.length > sources.length ? resolvedSources : sources;
        session.sources = finalSources;
        saveSession(session);
        if (resolvedSources.length > sources.length) {
          res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
        }

        // Update #Q entry with answer and sources
        if (qid) {
          try {
            qaStore.updateEntry(qid, { answer: assistantContent });
            // Also update sources via the entry's JSON sources field
            const dbEntry = qaStore.getEntryByQid(qid);
            if (dbEntry) {
              qaStore.updateEntry(qid, { tags: ['answered'] });
            }
          } catch (e) {
            log('error', 'failed to update #Q entry', { error: (e as Error)?.message });
          }
        }
      }
      res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
      res.end();
    } catch (err: any) {
      if (!aborted) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: err.message ?? 'Unknown error' }) + '\n\n');
        res.end();
      }
    }
  };
}
