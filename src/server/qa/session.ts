/**
 * Session 管理模块。
 *
 * 纯数据管理，不依赖任何 handler 逻辑。
 * 所有三种模式（LLM / ACP / LangGraph）共用。
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { QaMessage, QaSession, QaSessionSummary, QuestionSuggestion, FrequentQuestion } from './types.js';

/** Session 存储（内存 Map + 磁盘 JSON） */
export const sessions = new Map<string, QaSession>();

// 不自动清理 — ChatGPT 模式，永久保存
const SESSION_TTL_MS = Infinity;
const SESSION_MAX_AGE_MS = Infinity;
const CLEANUP_INTERVAL_MS = 0;

// ── 内部工具 ────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [qa] [' + level + '] ' + line);
}

/** Sanitize filename to prevent path traversal */
function safeName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

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
  return {
    id: s.id, repo: s.repo, messages: s.messages, sources: s.sources,
    acpSessionId: s.acpSessionId, qid: s.qid, mode: s.mode,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
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

// ── CRUD ────────────────────────────────────────────────────

async function saveSession(session: QaSession): Promise<void> {
  try {
    const dir = getDataDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(sessionFilePath(session.id), JSON.stringify(sessionToJson(session)), 'utf-8');
  } catch (e) {
    log('error', 'failed to save session', { id: session.id, error: (e as Error)?.message });
  }
}

export async function loadSessions(): Promise<void> {
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

export async function saveSessionToDisk(session: QaSession): Promise<void> {
  sessions.set(session.id, session);
  await saveSession(session);
}

export function updateSessionInMemory(id: string, updates: Partial<QaSession>): QaSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, updates, { updatedAt: new Date().toISOString() });
  return session;
}

export function getSession(id: string): QaSession | undefined {
  return sessions.get(id);
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

// ├─ 启动时从磁盘恢复 session ──────────────────────────────────
loadSessions();
// 清理已禁用 — session 永久保存，除非用户手动删除
