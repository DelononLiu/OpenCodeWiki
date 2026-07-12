/**
 * qa-endpoint.ts — LLM + ACP 问答处理器。
 *
 * 共享模块（qa/）已抽离到独立文件，本文件只包含 createQaEndpoint。
 * LLM 和 ACP 两种模式通过 config.json qaMode 字段切换。
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import type { ServerResponse } from 'http';
import { AcpClient, getQaMode, isAcpCrossRoot } from './acp/AcpClient.js';
import type { AcpMessageHandler } from './acp/types.js';
import * as qaStore from './qa-store.js';
import type { Domain } from './qa-store.js';
import { unifiedSearch } from './search-service.js';
import type { SearchResultEntity } from './search-service.js';
import { QaResolver, classifyScopeRule } from './qa-resolver.js';
import type { IntentResult, PipelineMatch, RepoInfo } from './qa-resolver.js';
import { getKnowledgeDb } from './knowledge-db.js';

// ── 共享模块（qa/） ──────────────────────────────────────────
import { sessions, getSession, saveSessionToDisk, updateSessionInMemory } from './qa/session.js';
import { resolveAnswerSources } from './qa/sources.js';
import {
  classifyDomain, domainProcessingFlow, structureGuide,
  hasChinese, buildSearchQuery, translateToEnglish,
} from './qa/prompt-utils.js';
import type { QaMessage, QaSession } from './qa/types.js';

const QA_MODE = getQaMode();
const ACP_CROSS_ROOT = isAcpCrossRoot();
const CROSS_REPO_ACP_CLIENT = '__cross__';

const repoClients = new Map<string, AcpClient>();
const repoActiveSessions = new Map<string, Set<string>>();

const MAX_SESSIONS_PER_REPO = 1000;

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [qa] [${level}] ` + (data ? msg + ' ' + JSON.stringify(data) : msg));
}

async function initRepoClient(repoName: string, repoBase: string): Promise<AcpClient | null> {
  const existing = repoClients.get(repoName);
  if (existing?.connected) return existing;
  const client = new AcpClient(repoBase);
  const ok = await client.connect();
  if (!ok) { log('error', 'ACP init failed', { repo: repoName, error: client.lastError }); return null; }
  repoClients.set(repoName, client);
  repoActiveSessions.set(repoName, new Set());
  log('info', 'ACP repo client ready', { repo: repoName });
  return client;
}

function buildPrompt(question: string, systemPrompt: string, isFirstTurn: boolean): string {
  const parts: string[] = [];
  if (isFirstTurn) parts.push('<system>\n' + systemPrompt + '\n</system>');
  parts.push('<user>\n' + question + '\n</user>');
  return parts.join('\n\n');
}

async function acpPrompt(
  client: AcpClient, acpSessionId: string, question: string, systemPrompt: string,
  isFirstTurn: boolean, res: ServerResponse, sessionId: string,
): Promise<string> {
  const prompt = buildPrompt(question, systemPrompt, isFirstTurn);
  let content = '';
  const handler: AcpMessageHandler = {
    onText: (text: string) => { content += text; res.write('data: ' + JSON.stringify({ type: 'token', content: text }) + '\n\n'); },
    onReasoning: (text: string) => { res.write('data: ' + JSON.stringify({ type: 'reasoning', content: text }) + '\n\n'); },
    onToolCall: () => {},
    onToolCallUpdate: () => {},
    onPlan: () => {},
    onError: (error: string) => { res.write('data: ' + JSON.stringify({ type: 'error', message: error }) + '\n\n'); },
    onDone: () => {},
  };
  await client.sendPrompt(acpSessionId, prompt, handler);
  return content;
}

// ── Dual-path route types ──────────────────────────────────────

export interface RouteResultDirect {
  type: 'direct';
  data: { answer: string; qid: number; tag: string; };
}
export interface RouteResultSuggestion {
  type: 'llm-with-suggestion';
  data: { context: { entities: SearchResultEntity[] }; suggestion: { qid: number; question: string; }; };
}
export interface RouteResultLlm {
  type: 'llm';
  data: { context: { entities: SearchResultEntity[] }; };
}
export type RouteResult = RouteResultDirect | RouteResultSuggestion | RouteResultLlm;

/**
 * routeQuestion — 统一搜索 + 路由决策。
 *
 * 1. 高置信度 (>=0.85) → direct（直接返回校准答案）
 * 2. 中等置信度 (0.5-0.85) → llm-with-suggestion（LLM 生成 + 相关问题推荐）
 * 3. 低置信度 (<0.5) → llm（纯 LLM 生成）
 */
export async function routeQuestion(question: string): Promise<RouteResult> {
  const results = await unifiedSearch(question);

  const topQa = results.qa[0];
  if (topQa && topQa.score >= 0.85) {
    const { getEntryDetail } = await import('./qa-store.js');
    const detail = getEntryDetail(topQa.qid);
    if (detail?.calibratedAnswer) {
      return {
        type: 'direct',
        data: {
          answer: detail.calibratedAnswer.answer,
          qid: topQa.qid,
          tag: 'standard',
        },
      };
    }
  }

  const context = { entities: results.entities };

  if (topQa && topQa.score >= 0.5) {
    return {
      type: 'llm-with-suggestion',
      data: {
        context,
        suggestion: { qid: topQa.qid, question: topQa.question },
      },
    };
  }

  return { type: 'llm', data: { context } };
}

/**
 * linkAnswerToEntities — QA 回答后自动关联实体。
 *
 * 1. 从问题文本中搜索匹配的实体（name / definition LIKE 匹配）
 * 2. 从回答中提取 #slug 标记
 * 3. 将关联写入 knowledge.db 的 entity_qa 表
 *
 * 不会抛出异常——所有错误都会被捕获并记录，避免影响 QA 响应。
 */
export async function linkAnswerToEntities(question: string, answer: string, qid: number | undefined): Promise<void> {
  if (qid === undefined || qid === null) return;

  try {
    const db = getKnowledgeDb();
    const q = question.toLowerCase();
    const a = answer.toLowerCase();

    const matchedSlugs = new Set<string>();

    // 1. Use SQL LIKE to find entities whose name or definition appears in question/answer text.
    //    This replaces the previous full table scan (SELECT slug, name FROM entities) + JS iteration.
    const rows = db.prepare(`
      SELECT slug FROM entities
      WHERE ? LIKE '%' || name || '%' OR ? LIKE '%' || name || '%'
         OR ? LIKE '%' || definition || '%' OR ? LIKE '%' || definition || '%'
    `).all(q, a, q, a) as { slug: string }[];

    for (const row of rows) {
      matchedSlugs.add(row.slug);
    }

    // 2. Extract #slug annotations from answer
    const slugRegex = /#([a-zA-Z0-9_-]+)/g;
    let m;
    while ((m = slugRegex.exec(answer)) !== null) {
      const slugEntity = db.prepare('SELECT slug FROM entities WHERE slug = ?').get(m[1]) as { slug: string } | undefined;
      if (slugEntity) {
        matchedSlugs.add(slugEntity.slug);
      }
    }

    if (matchedSlugs.size === 0) return;

    // 3. Write associations to entity_qa table
    const stmt = db.prepare('INSERT OR IGNORE INTO entity_qa(entity_slug, qid) VALUES(?, ?)');
    for (const slug of matchedSlugs) {
      stmt.run(slug, qid);
    }

    log('debug', 'linked QA to entities', { qid, slugs: [...matchedSlugs] });
  } catch (e) {
    log('error', 'linkAnswerToEntities failed (non-fatal)', { qid, error: (e as Error)?.message });
  }
}

export function createQaEndpoint(
  resolveRepo: (repoName?: string) => Promise<{ storagePath: string; name: string } | undefined>,
  resolveLLMConfig: () => Promise<any>,
  search: (query: string, repo?: string) => Promise<{ sources: any[]; flows?: string }>,
  listRepos?: () => Promise<{ name: string }[]>,
  searchCallers?: (symbol: string, repo?: string) => Promise<string>,
  searchImpact?: (symbol: string, repo?: string) => Promise<string>,
  crossRepoScope?: string[],
  handler?: any,
) {
  if (QA_MODE === 'acp' && listRepos) {
    listRepos().then(repos => { for (const r of repos) resolveRepo(r.name).then(e => { if (e) initRepoClient(r.name, e.storagePath); }); });
  }

  return async (req: any, res: any) => {
    let question = req.body?.question?.trim();
    const history: { role: string; content: string }[] = req.body?.history ?? [];
    const repoName = req.body?.repo ?? (req.query?.repo as string | undefined);
    let sessionId: string | undefined = req.body?.sessionId;
    const attachedFiles: { fileName: string; size: number }[] = req.body?.attachedFiles ?? [];
    const reqDomain: string | undefined = req.body?.questionType ?? req.body?.domain;

    if (!question) { res.status(400).json({ error: 'Missing "question" in request body' }); return; }
    log('info', '【Q】' + (repoName ?? '(全部)') + ': ' + question.slice(0, 60));

    let session = sessionId ? sessions.get(sessionId) : undefined;
    let qid: number | undefined;

    if (!session) {
      const newId = (sessionId && sessionId.length >= 8) ? sessionId : crypto.randomUUID();
      sessionId = newId;
      session = { id: sessionId, messages: [], sources: [], repo: repoName, mode: 'deep', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      sessions.set(sessionId, session);
      try {
        const entry = qaStore.createEntry({ sessionId, repo: repoName || '', question, mode: 'deep', sources: [], relatedQids: [] });
        qid = entry.qid; session.qid = qid;
      } catch (e) { log('error', 'failed to create #Q entry', { error: (e as Error)?.message }); }
    } else { qid = session.qid; }

    const hasCrossTag = /@cross\b/i.test(question);
    const repoAtMatch = question.match(/@(\w[\w-]*)\b/);
    const explicitRepo = repoAtMatch && repoAtMatch[1] !== 'cross' ? repoAtMatch[1] : undefined;
    const isCrossRepo = !!listRepos && (hasCrossTag || !repoName || !!explicitRepo);
    let crossRepoNames: string[] | undefined;
    if (explicitRepo) { crossRepoNames = [explicitRepo]; question = question.replace(new RegExp('@' + explicitRepo + '\\b\\s*', 'gi'), ''); }
    else if (crossRepoScope?.length) { crossRepoNames = crossRepoScope; }
    if (hasCrossTag) question = question.replace(/@cross\b\s*/gi, '');

    let entry = undefined;
    if (!isCrossRepo) { entry = await resolveRepo(repoName); }

    let llmConfig: any;
    try { llmConfig = await resolveLLMConfig(); } catch {}
    const hasLLM = !!llmConfig?.apiKey;

    if (QA_MODE !== 'acp' && !hasLLM) {
      res.status(500).json({ error: 'LLM not configured' }); return;
    }

    let searchQuery = question;
    if (hasChinese(question) && hasLLM) {
      const en = await translateToEnglish(question, llmConfig);
      if (en) searchQuery = buildSearchQuery(question, en);
    }

    let sources: any[] = [];
    let searchContent = '';
    let flowsText = '';
    let repoBaseMap: Map<string, string> | undefined;
    let pipelineContext = '';
    let pipelineIntent: string | undefined;
    let agentContext = '';

    try {
      if (isCrossRepo) {
        let allRepos = await listRepos!();
        if (crossRepoNames) allRepos = allRepos.filter(r => crossRepoNames!.includes(r.name));
        repoBaseMap = new Map();
        const allRepoResults: { repoName: string; sources: any[]; flows?: string }[] = [];
        await Promise.allSettled(allRepos.map(async (r) => {
          const repoEntry = await resolveRepo(r.name);
          if (!repoEntry) return;
          repoBaseMap!.set(r.name, repoEntry.storagePath);
          const result = await search(searchQuery, r.name);
          if (result?.sources?.length) allRepoResults.push({ repoName: r.name, sources: result.sources, flows: result.flows });
        }));
        const crossSources: any[] = [];
        for (const r of allRepoResults) {
          for (const s of r.sources.slice(0, 3)) {
            crossSources.push({ ...s, repo: r.repoName, filePath: r.repoName + ':' + s.filePath, fileName: r.repoName + ':' + (s.fileName ?? s.filePath?.split('/').pop() ?? '?'), refId: crossSources.length, rawPath: s.filePath });
          }
          if (r.flows) flowsText += r.flows + '\n';
        }
        for (const src of crossSources) {
          if (src.snippet) continue;
          const baseDir = repoBaseMap.get(src.repo);
          if (!baseDir || !src.rawPath) continue;
          try {
            const fullPath = path.join(baseDir, src.rawPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const start = src.startLine ? Math.max(0, src.startLine - 2) : 0;
            const end = src.endLine && src.endLine !== src.startLine ? Math.min(lines.length, src.endLine + 2) : Math.min(lines.length, start + 20);
            if (start < lines.length) src.snippet = lines.slice(start, end).map((l: string, i: number) => (start + i + 1) + ': ' + l).join('\n');
          } catch {}
        }
        sources = crossSources.slice(0, 10);
        const lines: string[] = [];
        for (const s of sources) {
          lines.push((s.label ?? 'File') + ': ' + s.fileName + ' — ' + s.filePath + (s.startLine ? ':' + s.startLine : ''));
          if (s.snippet) lines.push('```\n' + s.snippet + '\n```');
        }
        searchContent = lines.join('\n');
      } else {
        const { sources: searchResults, flows: rawFlows = '' } = await search(searchQuery, repoName);
        flowsText = rawFlows;
        const repoBase = entry ? entry.storagePath : null;
        for (const r of searchResults.slice(0, 5)) {
          const refId = sources.length;
          const sourceEntry: any = { filePath: r.filePath, label: r.label ?? 'File', startLine: r.startLine, endLine: r.endLine, fileName: r.filePath?.split('/').pop() ?? '?', snippet: '', refId };
          if (repoBase && r.filePath) {
            try {
              const srcContent = await fs.readFile(path.join(repoBase, r.filePath), 'utf-8');
              const srcLines = srcContent.split('\n');
              const start = r.startLine ? Math.max(0, r.startLine - 2) : 0;
              const end = r.endLine ? Math.min(srcLines.length, r.endLine + 2) : Math.min(srcLines.length, start + 20);
              sourceEntry.snippet = srcLines.slice(start, end).map((l: string, i: number) => (start + i + 1) + ': ' + l).join('\n');
            } catch {}
          }
          sources.push(sourceEntry);
        }
        searchContent = sources.map(s => (s.label ?? 'File') + ': ' + s.fileName + ' — ' + s.filePath + (s.startLine ? ':' + s.startLine : '') + '\n```\n' + s.snippet + '\n```').join('\n');
      }
    } catch (e) { log('error', 'search failed', { error: (e as Error)?.message }); }

    // Pipeline / intent analysis
    if (handler && !pipelineContext) {
      try {
        const resolver = new QaResolver((tool: string, args: any) => handler.execute(tool, args));
        const vs = (globalThis as any).__vectorStore;
        if (vs) resolver.setVectorSearch(vs);
        if (llmConfig?.apiKey) resolver.setLLMConfig({ apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model });
        const allRepoList = listRepos ? (await listRepos()).map(r => r.name) : [];
        const intentResult = await resolver.analyzeIntent(question, allRepoList);
        pipelineIntent = intentResult.intent;
        const repos: RepoInfo[] = [];
        if (isCrossRepo && repoBaseMap) { for (const [name, sp] of repoBaseMap) repos.push({ name, storagePath: sp }); }
        else if (entry) repos.push({ name: entry.name || repoName || 'default', storagePath: entry.storagePath });
        const matches = await resolver.search(intentResult, repos);
        pipelineContext = QA_MODE === 'acp' ? resolver.buildACPContext(matches, intentResult) : resolver.buildLLMContext(matches, intentResult);
      } catch (e) { log('warn', 'pipeline error (non-fatal)', { error: (e as Error)?.message }); }
    }

    log('info', '【✓】完成', { intent: pipelineIntent, sources: sources.length });

    if (QA_MODE !== 'acp' && handler && !pipelineContext && hasLLM) {
      pipelineContext = '## NOTE\n未在代码库中搜索到与问题相关的内容。请告知用户未找到相关代码，并引导用户提供更具体的信息（如函数名、错误信息、文件路径等）以便进一步定位。';
    }

    // Upload files context
    const stagingId = sessionId || 'staging';
    const uploadBase = path.join(os.homedir(), '.opencodewiki', 'uploads', stagingId);
    let uploadedContext = '';
    if (attachedFiles.length > 0) {
      const fragments: string[] = [];
      for (const f of attachedFiles) {
        try {
          const raw = await fs.readFile(path.join(uploadBase, f.fileName), 'utf-8');
          fragments.push(`📄 ${f.fileName} (${f.size} bytes, ${raw.split('\n').length} lines)`);
        } catch {}
      }
      if (fragments.length > 0) uploadedContext = '\n## USER UPLOADED FILES\n' + fragments.join('\n\n') + '\n';
    }

    const domain: Domain = reqDomain && ['general', 'log-analysis', 'stack-analysis', 'bug-analysis', 'build-issue', 'program-analysis'].includes(reqDomain) ? reqDomain as Domain : classifyDomain(question);
    const structure = structureGuide(pipelineIntent, domain);
    const domainFlow = domainProcessingFlow(domain);

    const sourceRefs = sources.map(s => s.filePath + (s.startLine ? ':' + s.startLine + (s.endLine && s.endLine !== s.startLine ? '-' + s.endLine : '') : '')).join('\n- ');

    let systemPrompt = 'You are opencodewiki, a code analyst. Answer the question in DeepWiki style.\n\n' +
      (agentContext ? `## 项目概览\n${agentContext}\n\n` : '') +
      '## RULES\n- Always answer in Chinese.\n- Use mermaid diagrams for architecture flows when relevant.\n- Use code blocks for commands or examples.\n- Keep paragraphs short (2-4 sentences).\n- Do not restate the question.\n- If unsure, say so.\n- 禁止写文件，所有内容直接输出。\n- 禁止使用 Explore Task。\n' +
      '- **回答输出格式必须严格遵循下方 ## 回答模板 中的一种模板（A/B/C/D/E），不允许自由发挥。**\n' +
      '- **问题相关信息搜索链路：search_graph（语义搜索符号）→ get_code_snippet（源码片段分析）→ trace_path（调用链追溯）→ grep（纯文本 fallback/提取）**\n' +
      '- 每个回答最多包含 6 个引用。\n' +
      (QA_MODE !== 'acp' ? '- **引用必须使用下方 SEARCH CONTEXT 中列出的精确路径，禁止编造不存在的文件路径。**\n' : '') +
      (isCrossRepo ? '- 引用格式：(repoName:path/file.ts:line)\n' : '- 引用格式：(relative/path/file.ts:line)\n') +
      '- 范围引用用 (path:start-end)\n' +
      (isCrossRepo ? '- 引用文件路径使用 仓库名+相对路径 格式\n' : '- 引用文件路径使用相对路径\n') +
      '\n' + domainFlow + '\n\n' + structure + '\n\n' +
      (uploadedContext ? uploadedContext + '\n' : '') +
      (pipelineContext ? pipelineContext + '\n\n---\n注意：以上是 PIPELINE 分析结果。\n\n' :
      QA_MODE !== 'acp' ? '## SEARCH CONTEXT\n以下是搜索到的代码文件：\n\n- ' + sourceRefs + (flowsText ? '\n\n### Execution Flows\n' + flowsText.slice(0, 2000) : '') + '\n\n---\n' : '');

    // ── 双路路由：先检查校准 QA 命中 ──────────────────────────────
    if (QA_MODE !== 'acp') {
      const routeResult = await routeQuestion(question);

      if (routeResult.type === 'direct') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.write('data: ' + JSON.stringify({ type: 'session', id: sessionId }) + '\n\n');
        if (qid) res.write('data: ' + JSON.stringify({ type: 'qid', qid }) + '\n\n');
        res.write('data: ' + JSON.stringify({ type: 'tag', tag: routeResult.data.tag, qid: routeResult.data.qid }) + '\n\n');
        res.write('data: ' + JSON.stringify({ type: 'token', content: routeResult.data.answer }) + '\n\n');
        // Auto-link entities from answer
        linkAnswerToEntities(question, routeResult.data.answer, qid).catch(() => {});
        res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
        res.end();
        return;
      }

      // Add entity context to system prompt
      if (routeResult.data.context?.entities?.length) {
        const entitySection = '## ENTITY KNOWLEDGE\n以下是与问题相关的实体知识：\n\n' +
          routeResult.data.context.entities
            .map((e: SearchResultEntity) => `- **${e.name}**: ${e.definition}`)
            .join('\n') + '\n\n';
        systemPrompt = entitySection + systemPrompt;
      }

      // Store suggestion footer for later append after LLM generation
      if (routeResult.type === 'llm-with-suggestion') {
        (session as any)._suggestionFooter = `\n\n---\n> \u{1F914} 你可能想问: [#Q${routeResult.data.suggestion.qid} ${routeResult.data.suggestion.question}](/qa?qid=${routeResult.data.suggestion.qid})`;
      }
    }

    // ── ACP 模式 ──────────────────────────────────────────────────
    if (QA_MODE === 'acp') {
      let acpRepoName: string | undefined;
      let acpRepoBase: string | undefined;
      if (isCrossRepo && repoBaseMap && repoBaseMap.size > 0) {
        if (ACP_CROSS_ROOT) { acpRepoName = CROSS_REPO_ACP_CLIENT; acpRepoBase = path.dirname([...repoBaseMap.values()][0]); }
        else { acpRepoName = [...repoBaseMap.keys()][0]; acpRepoBase = repoBaseMap.get(acpRepoName); }
      } else { acpRepoName = entry?.name; acpRepoBase = entry?.storagePath; }

      let acpSessionId = session?.acpSessionId;
      if (acpRepoName) {
        const client = repoClients.get(acpRepoName) || (await initRepoClient(acpRepoName, acpRepoBase ?? '.'));
        if (!client) {
          log('warn', 'ACP not available, falling back to LLM', { hasLLM });
        } else {
          if (!acpSessionId) {
            const sid = await client.createSession();
            if (sid) { acpSessionId = sid; session!.acpSessionId = sid; }
          }
          if (acpSessionId) {
            let aborted = false;
            req.on('close', () => { aborted = true; client.cancel(acpSessionId!); });
            try {
              const isFirstTurn = session!.messages.length <= 1;
              const content = await acpPrompt(client, acpSessionId, question, systemPrompt, isFirstTurn, res, sessionId!);
              if (content && !aborted) {
                session!.messages.push({ role: 'assistant', content });
                const resolvedSources = await resolveAnswerSources(content, sources, entry?.storagePath ?? null, repoBaseMap);
                session!.sources = resolvedSources.length > sources.length ? resolvedSources : sources;
                if (resolvedSources.length > sources.length) res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
              }
              // Auto-link entities from ACP answer
              linkAnswerToEntities(question, content || '', qid).catch(() => {});
              res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n'); res.end();
            } catch (err: any) {
              if (!aborted) { res.write('data: ' + JSON.stringify({ type: 'error', message: err.message }) + '\n\n'); res.end(); }
            }
            return;
          }
        }
      }
      log('warn', 'ACP not available, falling back to LLM', { hasLLM });
      if (!hasLLM) { res.write('data: ' + JSON.stringify({ type: 'error', message: 'No LLM or ACP backend' }) + '\n\n'); res.end(); return; }
    }

    // ── LLM 模式 ──────────────────────────────────────────────────
    if (!hasLLM) { res.status(500).json({ error: 'No LLM configured' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('data: ' + JSON.stringify({ type: 'session', id: sessionId }) + '\n\n');
    if (qid) res.write('data: ' + JSON.stringify({ type: 'qid', qid }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'sources', sources }) + '\n\n');

    session!.messages.push({ role: 'user', content: question });
    session!.updatedAt = new Date().toISOString();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...session!.messages.map(h => ({ role: h.role, content: h.content })),
    ];

    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders: Record<string, string> = llmConfig.provider === 'azure' ? { 'api-key': llmConfig.apiKey } : { Authorization: 'Bearer ' + llmConfig.apiKey };
    const reqBody: Record<string, unknown> = { model: llmConfig.model, messages, stream: true, max_completion_tokens: llmConfig.maxTokens ?? 16384 };
    if (llmConfig.temperature !== undefined) reqBody.temperature = llmConfig.temperature;

    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const response = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(reqBody) });
      if (!response.ok) { res.write('data: ' + JSON.stringify({ type: 'error', message: 'LLM API error' }) + '\n\n'); res.end(); return; }

      const decoder = new TextDecoder();
      const reader = response.body!.getReader();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        if (aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          if (trimmed.slice(6) === '[DONE]') continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { assistantContent += delta; res.write('data: ' + JSON.stringify({ type: 'token', content: delta }) + '\n\n'); }
          } catch {}
        }
      }

      // Append suggestion footer if applicable (from llm-with-suggestion routing)
      if (!aborted) {
        const suggestionFooter = (session as any)._suggestionFooter;
        if (suggestionFooter) {
          assistantContent += suggestionFooter;
          res.write('data: ' + JSON.stringify({ type: 'token', content: suggestionFooter }) + '\n\n');
        }
      }

      if (assistantContent) {
        session!.messages.push({ role: 'assistant', content: assistantContent });
        const resolvedSources = await resolveAnswerSources(assistantContent, sources, entry?.storagePath ?? null, repoBaseMap);
        session!.sources = resolvedSources.length > sources.length ? resolvedSources : sources;
        if (resolvedSources.length > sources.length) res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
      }
      // Auto-link entities from LLM answer
      linkAnswerToEntities(question, assistantContent, qid).catch(() => {});
      res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n'); res.end();
    } catch (err: any) {
      if (!aborted) { res.write('data: ' + JSON.stringify({ type: 'error', message: err.message }) + '\n\n'); res.end(); }
    }
  };
}
