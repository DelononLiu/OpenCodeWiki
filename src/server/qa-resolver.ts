/**
 * qa-resolver.ts — Pipeline 中间层
 *
 * Pipeline = 代码分析工具链的编排层。
 * 直接调 handler.execute('codegraph_xxx') 做符号级检索 + grep 做文本匹配。
 * 按意图组合工具链，产出结构化结果给 LLM 或 ACP Agent。
 *
 * 意图体系（面向程序员代码问答）：
 *   what-is         — 这是什么功能 / 代码做了什么
 *   where-is        — 定义 / 实现在哪里
 *   how-to          — 怎么用 / 如何调用 / 如何实现
 *   why-error       — 为什么报错 / 分析堆栈 / 排错
 *   what-structure  — 架构是什么 / 模块关系 / 整体设计
 *   what-impact     — 改了会影响谁 / 谁在调用
 */

import fs from 'fs/promises';
import path from 'path';

// ── Types ────────────────────────────────────────────────────────

export type Intent = 'what-is' | 'where-is' | 'how-to' | 'why-error' | 'what-structure' | 'what-impact';

export interface IntentResult {
  intent: Intent;
  symbols: string[];
  searchTerms: string[];
  reasoning?: string;
}

export type MatchKind = 'definition' | 'declaration' | 'reference' | 'unknown';

export interface PipelineMatch {
  name?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: MatchKind;
  score: number;
  snippet: string;
  repo?: string;
}

export interface RepoInfo {
  name: string;
  storagePath: string;
}

// ── Intent classification rules ──────────────────────────────────

const INTENT_MAP: { intent: Intent; patterns: RegExp[]; priority: number }[] = [
  {
    // "这个代码是做什么的" "X是什么功能" "解释一下这段代码" "what does this do"
    intent: 'what-is',
    priority: 3,
    patterns: [
      /(?:什么|是什么|做什么|干嘛|干什么|功能|作用|意思|含义|说明|解释|describe|explain|what\s+(?:does|is|are|do))\s*(?:的|是)?(?:代码|函数|方法|类|功能|作用|意思)?/i,
      /^what\s+(?:does|is|are|do)\s+/i,
      /^explain\s+/i,
      /^describe\s+/i,
      /这是\s*(?:什么|啥|哪)\s*(?:代码|功能|意思)/i,
    ],
  },
  {
    // "X定义在哪里" "find the definition of" "实现在哪"
    intent: 'where-is',
    priority: 3,
    patterns: [
      /在哪(?:里)?定义|在哪声明|定义在|实现在|声明在|位于|位置|located|defined\s+in|declared\s+in/i,
      /^(?:find|locate|search|show)\s+(?:the\s+)?(?:definition|declaration|location|source)/i,
      /where\s+(?:is|are|does|was)\s+/i,
      /(?:什么|哪些?)\s*(?:文件|目录|位置)/i,
    ],
  },
  {
    // "怎么用" "如何调用" "how to use" "how to implement"
    intent: 'how-to',
    priority: 4,
    patterns: [
      /^how\s+(?:to|do|can|would|should)/i,
      /用法|怎么用|如何使用|如何调用|调用方法|调用方式|示例|example|usage|用法示例|配置|configure|setup|install/i,
      /(?:怎样|如何)\s*(?:使用|调用|配置|实现|编写)/i,
      /给个\s*(?:例子|示例)/i,
    ],
  },
  {
    // "为什么报错" "分析堆栈" "Error: EACCES" "crash at"
    intent: 'why-error',
    priority: 5,
    patterns: [
      /(?:^|\s)(?:error|bug|crash|崩溃|报错|异常|failed|fail|错误|堆栈|栈|stack\s*trace|segment|死锁|泄漏|panic|fatal|OOM|内存|leak|deadlock|null|undefined)(?:\s|$|:|：)/i,
      /为什么\s*(?:会|报|出|有)?\s*(?:错|异常|崩溃|问题)/i,
      /(?:原因|根因|根源|导致|造成|引起)/i,
    ],
  },
  {
    // "架构是什么" "模块关系" "有哪些类型" "分类枚举"
    intent: 'what-structure',
    priority: 4,
    patterns: [
      /架构|设计|结构|模块|关系|overview|module|component|整体|类图|关系图|流程|dependenc|模块图|拓扑|体系|层次|分层/i,
      /^(?:what\s+is\s+the\s+)?(?:architecture|design|structure|overview)\s+/i,
      /(?:类型|分类|类别|种类|枚举|类别|属于|归属|范畴)/i,
      /(?:几类|哪些类|哪几类|哪些类型|哪些种|哪几种)/i,
      /有(?:哪些|哪几种|几类)/i,
    ],
  },
  {
    // "改了X影响谁" "谁调用了" "impact analysis"
    intent: 'what-impact',
    priority: 5,
    patterns: [
      /影响|impact|谁\s*(?:调用|使用|引用)|调用链|调用关系|依赖|依赖关系|上游|下游|波及|trigger|break|change/i,
      /^who\s+(?:calls|uses|invokes|references)/i,
      /(?:改成|修改|改动|变更|删除)\s*(?:后|了|的)?\s*(?:会|可能)?\s*(?:影响|波及)/i,
      /分析\s*(?:影响|范围|调用)/i,
    ],
  },
];

/** Common English/JS keywords to filter out from symbol extraction */
const CODE_KEYWORDS = new Set([
  'function', 'class', 'method', 'interface', 'type', 'enum', 'const',
  'let', 'var', 'import', 'export', 'default', 'extends', 'implements',
  'return', 'async', 'await', 'throw', 'try', 'catch', 'finally',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'this', 'super', 'typeof', 'instanceof',
  'void', 'null', 'undefined', 'true', 'false', 'module', 'namespace',
  'package', 'from', 'of', 'in', 'as', 'is', 'where',
  'error', 'bug', 'crash', 'stack', 'how', 'what', 'where', 'why',
  'when', 'which', 'who', 'whom', 'whose', 'explain', 'meaning',
  'usage', 'example', 'configure', 'setup', 'install', 'architecture',
  'design', 'structure', 'overview', 'does', 'do', 'did', 'has', 'have',
  'had', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'need', 'dare', 'ought', 'used', 'to', 'be', 'been', 'being',
  'am', 'is', 'are', 'was', 'were', 'aint', 'it', 'its', 'that', 'those',
  'this', 'these', 'the', 'a', 'an', 'and', 'or', 'but', 'not', 'no',
  'nor', 'both', 'either', 'neither', 'each', 'every', 'all', 'some',
  'any', 'none', 'many', 'much', 'few', 'several', 'most', 'lot',
  'load', 'more', 'less', 'other', 'another', 'such', 'own', 'same',
  'get', 'got', 'gotten', 'make', 'made', 'take', 'took', 'taken',
  'give', 'gave', 'given', 'find', 'found', 'show', 'showed', 'shown',
  'tell', 'told', 'ask', 'asked', 'work', 'worked', 'seem', 'seemed',
  'keep', 'kept', 'leave', 'left', 'let', 'lets', 'help', 'helped',
  'like', 'want', 'go', 'went', 'gone', 'come', 'came', 'know', 'knew',
  'known', 'think', 'thought', 'see', 'saw', 'seen', 'use', 'used',
  'need', 'needed', 'call', 'called', 'run', 'ran', 'write', 'wrote',
  'written', 'read', 'read', 'start', 'started', 'stop', 'stopped',
]);

const SYMBOL_RE = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;

// ── QaResolver ───────────────────────────────────────────────────

export class QaResolver {
  constructor(
    private executeTool: (tool: string, args: any) => Promise<{ content: [{ text: string }] }>,
  ) {}

  // ═══════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════

  /**
   * Step 1: 意图分析
   * 纯规则匹配（支持多意图命中时按 priority 排序），无 LLM 开销。
   * 未匹配任何意图时默认 what-is（最通用的"解释代码"意图）。
   */
  analyzeIntent(question: string): IntentResult {
    const intent = this.classifyIntent(question);
    const symbols = this.extractSymbols(question);
    const searchTerms = this.buildSearchTerms(intent, symbols, question);
    return { intent, symbols, searchTerms, reasoning: 'rule-based' };
  }

  /**
   * Step 2: 按意图编排 codegraph 工具链搜索
   */
  async search(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    switch (intent.intent) {
      case 'what-is':        return this.searchWhatIs(intent, repos, mode);
      case 'where-is':       return this.searchWhereIs(intent, repos, mode);
      case 'how-to':         return this.searchHowTo(intent, repos, mode);
      case 'why-error':      return this.searchWhyError(intent, repos, mode);
      case 'what-structure': return this.searchWhatStructure(intent, repos, mode);
      case 'what-impact':    return this.searchWhatImpact(intent, repos, mode);
    }
  }

  /**
   * LLM 模式：构建完整 pipeline 上下文 — 注入所有搜索结果
   */
  buildLLMContext(matches: PipelineMatch[], intent: IntentResult): string {
    if (matches.length === 0) return '';

    const lines: string[] = ['## PIPELINE ANALYSIS'];
    lines.push(`Intent: ${this.describeIntent(intent.intent)}`);
    if (intent.symbols.length > 0) lines.push(`Symbols: ${intent.symbols.join(', ')}`);
    lines.push(`Search terms: ${intent.searchTerms.join(', ')}`);
    if (intent.reasoning) lines.push(`Analysis: ${intent.reasoning}`);
    lines.push('');

    // Group by repo for readability
    const byRepo = new Map<string, PipelineMatch[]>();
    for (const m of matches) {
      const key = m.repo || 'default';
      if (!byRepo.has(key)) byRepo.set(key, []);
      byRepo.get(key)!.push(m);
    }

    for (const [repo, repoMatches] of byRepo) {
      lines.push(`### ${repo}`);
      for (const m of repoMatches) {
        const kindTag = m.kind !== 'unknown' ? ` [${m.kind}]` : '';
        const loc = `${m.filePath}${m.startLine ? ':' + m.startLine : ''}`;
        lines.push(`- **${m.name || path.basename(m.filePath)}**${kindTag} — ${loc} (score: ${m.score})`);
        if (m.snippet) {
          lines.push('```');
          lines.push(m.snippet);
          lines.push('```');
        }
      }
    }

    lines.push('');
    lines.push(`Total: ${matches.length} matches across ${byRepo.size} repos.`);
    return lines.join('\n');
  }

  /**
   * ACP 模式：构建精简 pipeline 上下文 — 只给 Agent 做线索
   */
  buildACPContext(matches: PipelineMatch[], intent: IntentResult): string {
    if (matches.length === 0) return '';

    const lines: string[] = ['## PIPELINE INITIAL FINDINGS'];
    lines.push(`Intent: ${this.describeIntent(intent.intent)}`);
    lines.push('The following are initial search results. Use codegraph tools (codegraph_search, codegraph_context, codegraph_callers, codegraph_callees, codegraph_impact) to dig deeper as needed.');
    lines.push('');

    const top = matches.slice(0, 5);
    for (const m of top) {
      const kindTag = m.kind !== 'unknown' ? ` [${m.kind}]` : '';
      const repoTag = m.repo ? `${m.repo}:` : '';
      lines.push(`- **${m.name || path.basename(m.filePath)}**${kindTag} — ${repoTag}${m.filePath}:${m.startLine || 1} (score: ${m.score})`);
    }
    if (matches.length > 5) {
      lines.push(`\n+${matches.length - 5} more. Use codegraph_search with "${intent.searchTerms[0] || ''}" for full results.`);
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════
  //  Intent-specific search strategies
  // ═══════════════════════════════════════════════════

  /** what-is: 搜索符号 → 展开定义 → 解释功能 */
  private async searchWhatIs(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    const terms = intent.searchTerms.slice(0, 3);
    const allMatches: PipelineMatch[] = [];

    for (const term of terms) {
      const repoMatches = await this.multiRepoSsearch(term, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand top results with full definition
    if (mode === 'llm') {
      ranked = await this.expandWithContext(ranked.slice(0, 5), repos);
    }

    return ranked;
  }

  /** where-is: 精确定位符号定义的位置（仅搜符号，不展开） */
  private async searchWhereIs(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    // Only search by exact symbol names — no extra fluff terms
    const terms = intent.symbols.length > 0 ? intent.symbols : intent.searchTerms.slice(0, 3);
    const allMatches: PipelineMatch[] = [];

    for (const term of terms) {
      const repoMatches = await this.multiRepoSsearch(term, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand top definition with context
    if (mode === 'llm') {
      ranked = await this.expandWithContext(ranked.slice(0, 5), repos);
    }

    return ranked;
  }

  /** how-to: 搜索用法 → 追踪调用链 → 展示上下文 */
  private async searchHowTo(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    const terms = intent.searchTerms.slice(0, 3);
    const allMatches: PipelineMatch[] = [];

    for (const term of terms) {
      const repoMatches = await this.multiRepoSsearch(term, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand with callers/callees to show usage context
    if (mode === 'llm') {
      ranked = await this.expandWithCallersCallees(ranked.slice(0, 3), repos);
    }

    return ranked;
  }

  /** why-error: grep 错误码 → codegraph 定位附近符号 → 展开上下文 */
  private async searchWhyError(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    const allMatches: PipelineMatch[] = [];

    // Separate error patterns (ALL_CAPS, numbers) from symbol names
    const errorPatterns: string[] = [];
    const symbolNames: string[] = [];

    for (const term of intent.searchTerms) {
      if ((term === term.toUpperCase() && term.length > 2 && term.length < 30) || /^\d+$/.test(term)) {
        errorPatterns.push(term);
      } else {
        symbolNames.push(term);
      }
    }

    // Phase 1: grep for error text patterns
    for (const pattern of errorPatterns.slice(0, 3)) {
      for (const repo of repos) {
        const grepMatches = await this.rawGrep(pattern, repo);
        allMatches.push(...grepMatches);
      }
    }

    // Phase 2: codegraph search for nearby symbols
    for (const sym of symbolNames.slice(0, 5)) {
      const repoMatches = await this.multiRepoSsearch(sym, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand with context for deeper analysis
    if (mode === 'llm' && ranked.length > 0) {
      ranked = await this.expandWithContext(ranked.slice(0, 5), repos);
    }

    return ranked;
  }

  /** what-structure: 搜索 → 展开定义 → 找到类型/接口/结构定义 */
  private async searchWhatStructure(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    const terms = intent.searchTerms.slice(0, 4);
    const allMatches: PipelineMatch[] = [];

    for (const term of terms) {
      const repoMatches = await this.multiRepoSsearch(term, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand top matches with actual definition content
    if (mode === 'llm') {
      ranked = await this.expandWithContext(ranked.slice(0, 5), repos);
    }

    return ranked;
  }

  /** what-impact: 追踪调用链 + impact 分析 → 展示影响范围 */
  private async searchWhatImpact(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    const terms = intent.searchTerms.slice(0, 3);
    const allMatches: PipelineMatch[] = [];

    for (const term of terms) {
      const repoMatches = await this.multiRepoSsearch(term, repos);
      allMatches.push(...repoMatches);
    }

    let ranked = this.rankAndDedup(allMatches);

    // LLM mode: expand with callers + impact for full picture
    if (mode === 'llm' && ranked.length > 0) {
      // First try callers/callees for top result
      const top = ranked[0];
      if (top.name) {
        const repo = repos.find(r => r.name === top.repo);
        const [callers, impact] = await Promise.all([
          this.rawCallers(top.name, repo),
          this.rawImpact(top.name, repo),
        ]);
        const parts = [
          callers ? `Callers:\n${callers}` : '',
          impact ? `Impact:\n${impact}` : '',
        ].filter(Boolean);
        if (parts.length > 0) {
          ranked[0] = { ...top, snippet: parts.join('\n\n') };
        }
      }
    }

    return ranked;
  }

  // ═══════════════════════════════════════════════════
  //  Codegraph tool wrappers
  // ═══════════════════════════════════════════════════

  private rawSearch(query: string, repo?: RepoInfo): Promise<string> {
    const args: any = { query, maxResults: 15 };
    if (repo?.storagePath) args.projectPath = repo.storagePath;
    return this.safeTool('codegraph_search', args);
  }

  /** Safe tool call: returns empty string on error/unknown tool responses */
  private async safeTool(tool: string, args: any): Promise<string> {
    try {
      const result = await this.executeTool(tool, args);
      const text = result?.content?.[0]?.text || '';
      // codegraph returns "Error: Unknown tool: ..." when a tool isn't available
      if (text.startsWith('Error:')) return '';
      return text;
    } catch { return ''; }
  }

  private rawContext(symbol: string, repo?: RepoInfo): Promise<string> {
    const args: any = { symbol };
    if (repo?.storagePath) args.projectPath = repo.storagePath;
    return this.safeTool('codegraph_context', args);
  }

  private rawCallers(symbol: string, repo?: RepoInfo): Promise<string> {
    const args: any = { symbol, limit: 10 };
    if (repo?.storagePath) args.projectPath = repo.storagePath;
    return this.safeTool('codegraph_callers', args);
  }

  private rawCallees(symbol: string, repo?: RepoInfo): Promise<string> {
    const args: any = { symbol, limit: 10 };
    if (repo?.storagePath) args.projectPath = repo.storagePath;
    return this.safeTool('codegraph_callees', args);
  }

  private rawImpact(symbol: string, repo?: RepoInfo): Promise<string> {
    const args: any = { symbol, depth: 2 };
    if (repo?.storagePath) args.projectPath = repo.storagePath;
    return this.safeTool('codegraph_impact', args);
  }

  /** Simple recursive grep within a repo directory */
  private async rawGrep(pattern: string, repo: RepoInfo): Promise<PipelineMatch[]> {
    const matches: PipelineMatch[] = [];
    const grepExts = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp',
      '.kt', '.swift', '.rb', '.php', '.vue', '.svelte',
      '.md', '.json', '.yaml', '.yml', '.conf', '.cfg', '.ini',
      '.toml', '.xml', '.gradle', '.cmake', '.mak',
    ]);

    try {
      await this.grepWalk(repo.storagePath, pattern, repo.storagePath, matches, grepExts, 2);
    } catch {}
    return matches;
  }

  private async grepWalk(
    dir: string, pattern: string, baseDir: string,
    matches: PipelineMatch[], exts: Set<string>, depth: number,
  ): Promise<void> {
    if (depth <= 0) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as any[]);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'target') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.grepWalk(fullPath, pattern, baseDir, matches, exts, depth - 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!exts.has(ext)) continue;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              matches.push({
                name: lines[i].trim().slice(0, 100),
                filePath: path.relative(baseDir, fullPath),
                startLine: i + 1,
                endLine: i + 1,
                kind: 'reference',
                score: 50,
                snippet: lines.slice(start, end).map((l, j) => `${start + j + 1}: ${l}`).join('\n'),
                repo: path.basename(baseDir),
              });
              break;
            }
          }
        } catch {}
      }
    }
  }

  // ═══════════════════════════════════════════════════
  //  Expansion helpers
  // ═══════════════════════════════════════════════════

  /** Expand matches with full definition context. Falls back to grep. */
  private async expandWithContext(matches: PipelineMatch[], repos: RepoInfo[]): Promise<PipelineMatch[]> {
    const expanded: PipelineMatch[] = [];
    for (const m of matches) {
      const repo = repos.find(r => r.name === m.repo);
      // First try codegraph_context (structured symbol info)
      let ctx = m.name ? await this.rawContext(m.name, repo) : '';
      // Fallback: grep the symbol in the repo to find its definition/context
      if (!ctx && m.name && repo) {
        const grepMatches = await this.rawGrep(m.name, repo);
        if (grepMatches.length > 0) {
          ctx = grepMatches.slice(0, 3).map(g =>
            `${g.filePath}:${g.startLine}\n${g.snippet}`
          ).join('\n---\n');
        }
      }
      expanded.push(ctx ? { ...m, snippet: ctx } : m);
    }
    return expanded;
  }

  /** Expand matches with caller/callee info */
  private async expandWithCallersCallees(matches: PipelineMatch[], repos: RepoInfo[]): Promise<PipelineMatch[]> {
    const expanded: PipelineMatch[] = [];
    for (const m of matches) {
      if (!m.name) { expanded.push(m); continue; }
      const repo = repos.find(r => r.name === m.repo);
      const [callers, callees] = await Promise.all([
        this.rawCallers(m.name, repo),
        this.rawCallees(m.name, repo),
      ]);
      const parts = [callers ? `Callers:\n${callers}` : '', callees ? `Callees:\n${callees}` : ''].filter(Boolean);
      if (parts.length > 0) expanded.push({ ...m, snippet: parts.join('\n\n') });
      else expanded.push(m);
    }
    return expanded;
  }

  /** Expand matches with impact analysis */
  private async expandWithImpact(matches: PipelineMatch[], repos: RepoInfo[]): Promise<PipelineMatch[]> {
    const expanded: PipelineMatch[] = [];
    for (const m of matches) {
      if (!m.name) { expanded.push(m); continue; }
      const repo = repos.find(r => r.name === m.repo);
      const impact = await this.rawImpact(m.name, repo);
      if (impact) expanded.push({ ...m, snippet: impact });
      else expanded.push(m);
    }
    return expanded;
  }

  // ═══════════════════════════════════════════════════
  //  Result parsing & ranking
  // ═══════════════════════════════════════════════════

  /** Search one term across all repos in parallel */
  private async multiRepoSsearch(term: string, repos: RepoInfo[]): Promise<PipelineMatch[]> {
    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        const raw = await this.rawSearch(term, repo);
        return this.parseResults(raw, repo.name);
      }),
    );
    const all: PipelineMatch[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }
    return all;
  }

  /** Parse codegraph_search output into PipelineMatch[] */
  private parseResults(rawText: string, repoName: string): PipelineMatch[] {
    if (!rawText) return [];
    const matches: PipelineMatch[] = [];
    const lines = rawText.split('\n');
    let currentName = '';
    let currentKind = 'unknown';

    for (const line of lines) {
      const headerMatch = line.match(/^###\s+(.+?)(?:\s+\((\w+)\))?\s*$/);
      if (headerMatch) {
        currentName = headerMatch[1];
        currentKind = headerMatch[2] || 'unknown';
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('##') || trimmed.startsWith('*') ||
          trimmed.startsWith('Error') || trimmed.startsWith('>') || trimmed.startsWith('```')) {
        continue;
      }

      const lineMatch = trimmed.match(/^(.+?):(\d+)$/);
      if (lineMatch) {
        const fp = lineMatch[1];
        const ln = parseInt(lineMatch[2], 10);
        if (fp && !isNaN(ln)) {
          matches.push({
            name: currentName || path.basename(fp),
            filePath: fp,
            startLine: ln,
            endLine: ln,
            kind: this.classifyKind(currentKind),
            score: currentKind === 'definition' ? 100 : currentKind === 'declaration' ? 80 : 60,
            snippet: '',
            repo: repoName,
          });
        }
        continue;
      }

      if (/^[/.\w]/.test(trimmed) && (trimmed.startsWith('/') || trimmed.startsWith('src/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('lib/') || trimmed.startsWith('packages/'))) {
        matches.push({
          name: currentName || path.basename(trimmed),
          filePath: trimmed,
          startLine: 1,
          endLine: 1,
          kind: this.classifyKind(currentKind),
          score: 50,
          snippet: '',
          repo: repoName,
        });
      }
    }

    return matches;
  }

  /** Map codegraph kind string to internal MatchKind */
  private classifyKind(kind: string): MatchKind {
    const k = kind.toLowerCase();
    if (k === 'definition' || k === 'def' || k === 'define') return 'definition';
    if (k === 'declaration' || k === 'decl' || k === 'declare') return 'declaration';
    if (k === 'reference' || k === 'ref' || k === 'refer' || k === 'usage' || k === 'use') return 'reference';
    return 'unknown';
  }

  /** Dedup + sort: definition > declaration > reference > unknown, same kind by score desc */
  private rankAndDedup(matches: PipelineMatch[]): PipelineMatch[] {
    const seen = new Set<string>();
    const deduped: PipelineMatch[] = [];

    const kindOrder: Record<MatchKind, number> = {
      definition: 0, declaration: 1, reference: 2, unknown: 3,
    };

    for (const m of matches) {
      const key = `${m.filePath}:${m.startLine}${m.repo ? ':' + m.repo : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(m);
    }

    deduped.sort((a, b) => {
      const ka = kindOrder[a.kind] ?? 99;
      const kb = kindOrder[b.kind] ?? 99;
      if (ka !== kb) return ka - kb;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    return deduped;
  }

  // ═══════════════════════════════════════════════════
  //  Intent analysis helpers
  // ═══════════════════════════════════════════════════

  /** 多规则匹配：命中多个时按 priority 取最高 */
  private classifyIntent(question: string): Intent {
    const q = question.trim();
    let best: Intent = 'what-is';  // 默认兜底
    let bestPriority = -1;

    for (const rule of INTENT_MAP) {
      if (rule.patterns.some(p => p.test(q)) && rule.priority > bestPriority) {
        best = rule.intent;
        bestPriority = rule.priority;
      }
    }

    return best;
  }

  private extractSymbols(question: string): string[] {
    const candidates: string[] = [];
    const matches = question.matchAll(SYMBOL_RE);
    for (const m of matches) {
      const word = m[0];
      if (!CODE_KEYWORDS.has(word.toLowerCase()) && word.length >= 2) {
        candidates.push(word);
      }
    }
    return [...new Set(candidates)];
  }

  private buildSearchTerms(intent: Intent, symbols: string[], question: string): string[] {
    const terms: string[] = [];

    switch (intent) {
      case 'what-is':
        // Symbol + contextual words for understanding what it does
        terms.push(...symbols);
        if (symbols.length === 0) {
          const words = question.split(/\s+/).filter(w => w.length > 3 && !CODE_KEYWORDS.has(w.toLowerCase()));
          terms.push(...words.slice(0, 5));
        }
        break;

      case 'where-is':
        // Only exact symbol names — quick and precise
        terms.push(...symbols);
        break;

      case 'how-to': {
        terms.push(...symbols);
        // Add contextual terms for finding usage patterns
        const configHints = ['config', 'example', 'usage', 'setup', 'init'];
        for (const s of symbols) {
          terms.push(...configHints.map(h => `${s} ${h}`));
        }
        break;
      }

      case 'why-error': {
        // Extract error codes first (ALL_CAPS patterns)
        const errorCodes = question.match(/\b([A-Z][A-Z_0-9]{2,})\b/g);
        if (errorCodes) terms.push(...errorCodes);
        // Extract error:value patterns
        const errPattern = question.match(/[Ee][Rr][Rr][Oo][Rr]?\s*:?\s*(.+?)(?:\s|$)/g);
        if (errPattern) terms.push(...errPattern.map(e => e.replace(/^(?:Error|ERROR|err):?\s*/i, '').trim()).filter(Boolean));
        terms.push(...symbols);
        break;
      }

      case 'what-structure':
        terms.push(...symbols);
        if (symbols.length > 0) {
          terms.push(...symbols.map(s => `${s} module`));
          terms.push(...symbols.map(s => `${s} interface`));
          terms.push(...symbols.map(s => `${s} type`));
          terms.push(...symbols.map(s => `${s} enum`));
        }
        terms.push('index', 'main', 'README', 'package', 'types', 'enum', 'kind');
        break;

      case 'what-impact':
        terms.push(...symbols);
        terms.push(...symbols.map(s => `${s} usage`));
        terms.push(...symbols.map(s => `${s} reference`));
        break;
    }

    return [...new Set(terms)].filter(t => t.length >= 2);
  }

  /** Human-readable intent description for pipeline context output */
  private describeIntent(intent: Intent): string {
    const labels: Record<Intent, string> = {
      'what-is': 'What is this — 说明功能',
      'where-is': 'Where is — 定位定义位置',
      'how-to': 'How to — 用法与示例',
      'why-error': 'Why error — 排错分析',
      'what-structure': 'What structure — 架构与模块关系',
      'what-impact': 'What impact — 影响范围分析',
    };
    return labels[intent] || intent;
  }
}
