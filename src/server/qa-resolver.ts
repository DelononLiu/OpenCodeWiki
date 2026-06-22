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
import os from 'os';

// ── 向量搜索接口（由外部注入，避免 ESM/TS 编译路径问题）────────────────
export interface VectorSearchAPI {
  embedText(text: string): Promise<number[]>;
  vectorSearch(repoName: string, queryVec: number[], topK?: number): { nodeId: string; score: number }[];
  rrfMerge(ftsResults: {nodeId: string}[], vecResults: {nodeId: string; distance: number}[], k?: number): {nodeId: string; rrfScore: number}[];
}

/** LLM 配置接口 */
export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

// ── Types ────────────────────────────────────────────────────────

export type Intent = 'what-is' | 'where-is' | 'how-to' | 'why-error' | 'what-structure' | 'what-impact';

export interface IntentResult {
  intent: Intent;
  symbols: string[];
  searchTerms: string[];
  /** 原始问题中提取的中文短语，用于 grep 直接搜文件内容（BM25 对中文无效） */
  chineseTerms?: string[];
  /** 原始问题，用于两阶段搜索中的 LLM 筛选 */
  question?: string;
  reasoning?: string;
}

/** 搜索范围：单库 / 多库各类 */
export type Scope = 'single' | 'cross-compare' | 'cross-call' | 'global-search' | 'impact';

export interface ScopeResult {
  scope: Scope;
  /** 目标仓库列表（单库/多库） */
  repos: string[];
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
    // "架构是什么" "模块关系" "分类枚举"
    intent: 'what-structure',
    priority: 4,
    patterns: [
      /架构|设计|结构|模块|关系|overview|module|component|整体|类图|关系图|流程|dependenc|模块图|拓扑|体系|层次|分层/i,
      /(?:关系|列表|结构|枚举|归类|架构)/i,
      /^(?:what\s+is\s+the\s+)?(?:architecture|design|structure|overview)\s+/i,
      /(?:分类|类别|种类|枚举|类别|属于|归属|范畴)/i,
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

/** 检测问题是否涉及跨库引用 */
function reasonIncludesCrossRepo(q: string): boolean {
  return /依赖|引用|调用.*(?:库|模块|服务)|import.*from|跨库|微服务|服务.*调用/.test(q);
}

// ── QaResolver ───────────────────────────────────────────────────

export class QaResolver {
  private vs: VectorSearchAPI | null = null;
  private llm: LLMConfig | null = null;
  /** 第2轮深读结果，由 buildLLMContext 使用 */
  private _deepSnippets: Map<string, string> = new Map();
  /** 第2轮精筛结果，供前端右侧列表展示（只有精选文件，不含第一轮噪声） */
  private _sourceMatches: PipelineMatch[] = [];

  constructor(
    private executeTool: (tool: string, args: any) => Promise<{ content: [{ text: string }] }>,
  ) {}

  /** 第2轮精筛结果（供前端展示），无第二轮时返回空 */
  getRefinedSources(): PipelineMatch[] { return this._sourceMatches; }

  /** 注入向量搜索服务（可选，不注入时纯 FTS5）*/
  setVectorSearch(vs: VectorSearchAPI) { this.vs = vs; }

  /** 注入 LLM 配置（可选，用于低置信度时 LLM 兜底分类）*/
  setLLMConfig(cfg: LLMConfig) { this.llm = cfg; }

  // ═══════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════

  /**
   * Step 1: 意图分析
   * LLM 分类为主，规则为异常降级。
   */
  async analyzeIntent(question: string, repoDescs?: string[], history?: string): Promise<IntentResult> {
    let intent: Intent;
    let reasoning = '';
    let english_query: string | undefined;

    if (this.llm && repoDescs) {
      const result = await this.classifyByLLM(question, repoDescs, history);
      reasoning = 'llm';
      if (result) {
        intent = result.intent;
        english_query = result.english_query;
        reasoning += ' scope:' + result.scope;
      } else {
        intent = this.classifyIntentWithScore(question).intent;
        reasoning = 'llm-rule-fallback';
      }
    } else if (this.llm) {
      const llmIntent = await this.classifyByLLM(question, []);
      if (llmIntent) { intent = llmIntent.intent; english_query = llmIntent.english_query; reasoning = 'llm'; }
      else { intent = this.classifyIntentWithScore(question).intent; reasoning = 'llm-rule-fallback'; }
    } else {
      intent = this.classifyIntentWithScore(question).intent;
      reasoning = 'rule';
    }

    const symbols = this.extractSymbols(question);
    let searchTerms = this.buildSearchTerms(intent, symbols, question);

    // 用 LLM 翻译的英文关键词替换中文词。
    // 每个关键词作为独立搜索词，各自 BM25 搜索后合并结果，
    // 比整句翻译权重更集中、匹配更精准。
    if (english_query) {
      const keywords = english_query.split(/\s+/).filter(k => k.length >= 2 && !CODE_KEYWORDS.has(k));
      console.log('[qa]   ▸ english_query:', english_query);
      console.log('[qa]   ▸ keywords:', JSON.stringify(keywords));
      // 取最多 3 个不重复关键词
      const existing = new Set(searchTerms.filter(t => !/[一-鿿]/.test(t)));
      for (const kw of keywords) {
        if (kw.length >= 2 && !existing.has(kw) && existing.size < 3) {
          existing.add(kw);
        }
      }
      searchTerms = [...existing];
    }

    console.log('[qa]   ▸ searchTerms:', JSON.stringify(searchTerms));
    return { intent, symbols, searchTerms, reasoning, chineseTerms: this.extractChinesePhrases(question), question };
  }

  // ═══════════════════════════════════════════════════
  //  Scope classification (standalone, used by both resolver and endpoint)
  // ═══════════════════════════════════════════════════

  classifyScope(question: string, allRepos: string[]): ScopeResult {
    return classifyScopeRule(question, allRepos);
  }

  /**
   * Step 2: 按意图编排 codegraph 工具链搜索
   *
   * 两阶段搜索策略：
   *   第1轮 — BM25 + grep 广撒网，拿到候选文件列表
   *   筛选  — LLM 看候选列表，选最相关文件 + 建议新搜索词
   *   第2轮 — 搜新词（精准 BM25）+ 并行深读选中文件
   */
  async search(intent: IntentResult, repos: RepoInfo[], mode: 'llm' | 'acp'): Promise<PipelineMatch[]> {
    // ── 第1轮：BM25 + grep ──
    let matches: PipelineMatch[];
    switch (intent.intent) {
      case 'what-is':        matches = await this.searchWhatIs(intent, repos, mode); break;
      case 'where-is':       matches = await this.searchWhereIs(intent, repos, mode); break;
      case 'how-to':         matches = await this.searchHowTo(intent, repos, mode); break;
      case 'why-error':      matches = await this.searchWhyError(intent, repos, mode); break;
      case 'what-structure': matches = await this.searchWhatStructure(intent, repos, mode); break;
      case 'what-impact':    matches = await this.searchWhatImpact(intent, repos, mode); break;
      default:               matches = await this.searchWhatIs(intent, repos, mode); break;
    }

    // 中文 grep 补充
    if (intent.chineseTerms?.length) {
      for (const ct of intent.chineseTerms) {
        for (const repo of repos) {
          const grepMatches = await this.rawGrep(ct, repo);
          if (grepMatches.length > 0) matches.push(...grepMatches);
        }
      }
    }

    matches = this.rankAndDedup(matches);

    // ── 第2轮：候选筛选 + 深读（仅 LLM 模式，有 LLM 配置且不是太简单的问题）──
    if (mode === 'llm' && this.llm && intent.question && intent.question.length > 6 && matches.length > 0) {
      const candidates = this.buildCandidateList(matches);
      console.log('[qa]   ▸ round2 candidates:', candidates.length, 'chars,', matches.length, 'matches');
      const filter = await this.filterCandidates(intent.question, candidates);

      if (filter) {
        console.log('[qa]   ▸ round2 filter:', JSON.stringify({
          files: filter.selectedFiles.length,
          newTerms: filter.newTerms,
        }));
        // 深读选中文件
        const refinedMatches: PipelineMatch[] = [];
        if (filter.selectedFiles.length > 0) {
          const deepSnippets = await this.deepReadFiles(filter.selectedFiles, repos);
          this._deepSnippets = deepSnippets;
          // 选中文件本身作为精筛结果（只输出文件路径，不做全仓 grep）
          for (const f of filter.selectedFiles) {
            refinedMatches.push({
              name: path.basename(f.filePath),
              filePath: f.filePath,
              startLine: 1, endLine: 1, kind: 'reference', score: 100,
              snippet: '', repo: f.repo,
            });
          }
        }

        // 用新词补搜 BM25
        if (filter.newTerms.length > 0) {
          const extraIntent = { ...intent, searchTerms: filter.newTerms.slice(0, 2) };
          let extra: PipelineMatch[];
          switch (intent.intent) {
            case 'what-is':        extra = await this.searchWhatIs(extraIntent, repos, mode); break;
            case 'where-is':       extra = await this.searchWhereIs(extraIntent, repos, mode); break;
            case 'how-to':         extra = await this.searchHowTo(extraIntent, repos, mode); break;
            case 'why-error':      extra = await this.searchWhyError(extraIntent, repos, mode); break;
            case 'what-structure': extra = await this.searchWhatStructure(extraIntent, repos, mode); break;
            case 'what-impact':    extra = await this.searchWhatImpact(extraIntent, repos, mode); break;
            default:               extra = await this.searchWhatIs(extraIntent, repos, mode); break;
          }
          if (extra.length > 0) {
            console.log('[qa]   ▸ round2 new matches:', extra.length);
            refinedMatches.push(...extra);
            matches.push(...extra);
          }
          matches = this.rankAndDedup(matches);
        }

        // 保存精筛结果供前端展示（不含第一轮噪声）
        this._sourceMatches = this.rankAndDedup(refinedMatches);
      }
    }

    console.log('[qa]   ▸ final matches:', matches.length);
    return matches;
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
        const repoPrefix = m.repo ? `${m.repo}:` : '';
        const loc = `${repoPrefix}${m.filePath}${m.startLine ? ':' + m.startLine : ''}`;
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

    // 第2轮深读结果（如已执行）
    if (this._deepSnippets.size > 0) {
      lines.push('');
      lines.push('## 第2轮深读 — 选中文件的源码关键段');
      for (const [filePath, snippet] of this._deepSnippets) {
        lines.push(`### ${filePath}`);
        lines.push('```');
        lines.push(snippet);
        lines.push('```');
      }
      // 清空，避免影响下次查询
      this._deepSnippets.clear();
    }

    // 对比类问题：引导 LLM 从源码中提取维度做结构化对比
    if (intent.question && /区别|差异|vs|对比|difference|versus/i.test(intent.question)) {
      lines.push('');
      lines.push('### 对比维度指导');
      lines.push('这是一个对比类问题。搜索结果中的文件分属两个系统，');
      lines.push(`请根据搜索词「${intent.searchTerms.slice(0, 3).join('、')}」${intent.chineseTerms?.length ? `和中文概念「${intent.chineseTerms.join('、')}」` : ''}判断每个文件属于哪个系统。`);
      lines.push('');
      lines.push('请将搜索结果中的文件按所属系统分组，从以下方向对比：');
      lines.push('- 状态管理（有状态 vs 无状态）');
      lines.push('- 会话/Session 模型');
      lines.push('- 消息/数据处理方式');
      lines.push('- 入口出口与触发方式');
      lines.push('- 存储与持久化');
      lines.push('以对比表结尾。');
    }

    return lines.join('\n');
  }

  /**
   * ACP 模式：构建精简 pipeline 上下文 — 只给 Agent 做线索
   */
  buildACPContext(matches: PipelineMatch[], intent: IntentResult): string {
    if (matches.length === 0) return '';

    const lines: string[] = ['## PIPELINE INITIAL FINDINGS'];
    lines.push(`Intent: ${this.describeIntent(intent.intent)}`);
    lines.push('The following are initial search results. Use codebase-memory tools (search_graph, get_code_snippet, trace_path) to dig deeper as needed.');
    lines.push('');

    const top = matches.slice(0, 10);
    for (const m of top) {
      const kindTag = m.kind !== 'unknown' ? ` [${m.kind}]` : '';
      const repoTag = m.repo ? `${m.repo}:` : '';
      lines.push(`- **${m.name || path.basename(m.filePath)}**${kindTag} — ${repoTag}${m.filePath}:${m.startLine || 1} (score: ${m.score})`);
    }
    if (matches.length > 10) {
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

    // LLM mode: expand top results with full definition, keep tail matches
    if (mode === 'llm' && ranked.length > 0) {
      const topN = Math.min(10, ranked.length);
      const expanded = await this.expandWithContext(ranked.slice(0, topN), repos);
      ranked = [...expanded, ...ranked.slice(topN)];
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
    if (mode === 'llm' && ranked.length > 0) {
      const topN = Math.min(10, ranked.length);
      const expanded = await this.expandWithContext(ranked.slice(0, topN), repos);
      ranked = [...expanded, ...ranked.slice(topN)];
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
      const topN = Math.min(10, ranked.length);
      const expanded = await this.expandWithContext(ranked.slice(0, topN), repos);
      ranked = [...expanded, ...ranked.slice(topN)];
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
    if (mode === 'llm' && ranked.length > 0) {
      const topN = Math.min(10, ranked.length);
      const expanded = await this.expandWithContext(ranked.slice(0, topN), repos);
      ranked = [...expanded, ...ranked.slice(topN)];
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
    const args: any = { query, maxResults: 30 };
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

  /**
   * grep 搜索：优先用 codebase-memory-mcp 的 search_code（快速、全深度），
   * 失败时回退到文件系统遍历。
   */
  private async rawGrep(pattern: string, repo: RepoInfo): Promise<PipelineMatch[]> {
    // 优先走 search_code（索引内的全深度搜索）
    if (repo.storagePath) {
      try {
        const raw = await this.safeTool('search_code', {
          pattern,
          projectPath: repo.storagePath,
          mode: 'compact',
          maxResults: 50,
        });
        if (raw) {
          const parsed = this.parseGrepResults(raw, repo.name || path.basename(repo.storagePath));
          if (parsed.length > 0) return parsed;
        }
      } catch {}
    }

    // 回退：文件系统遍历（depth 限制为 4，覆盖大部分源码结构）
    const matches: PipelineMatch[] = [];
    const grepExts = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp',
      '.kt', '.swift', '.rb', '.php', '.vue', '.svelte',
      '.md', '.json', '.yaml', '.yml', '.conf', '.cfg', '.ini',
      '.toml', '.xml', '.gradle', '.cmake', '.mak',
    ]);
    try {
      await this.grepWalk(repo.storagePath, pattern, repo.storagePath, matches, grepExts, 4);
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

  /** Search one term across all repos in parallel（支持 FTS5 + 向量混合检索）*/
  private async multiRepoSsearch(term: string, repos: RepoInfo[]): Promise<PipelineMatch[]> {
    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        const raw = await this.rawSearch(term, repo);
        return this.parseResults(raw, repo.name);
      }),
    );
    let all: PipelineMatch[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }

    // 向量搜索 + RRF 融合（如已注入）
    if (this.vs && repos.length > 0) {
      try {
        const queryVec = await this.vs.embedText(term);
        for (const repo of repos) {
          const vecResults = this.vs.vectorSearch(repo.name, queryVec, 10);
          if (vecResults.length === 0) continue;
          // 向量结果映射为 PipelineMatch
          const projectName = repo.storagePath ? repo.storagePath.replace(/^\//, '').replace(/\//g, '-') : repo.name;
          const cbmDbDir = path.join(os.homedir(), '.cache', 'codebase-memory-mcp');
          const codegraphDb = path.join(cbmDbDir, projectName + '.db');
          try {
            const { DatabaseSync } = await import('node:sqlite');
            const db = new DatabaseSync(codegraphDb);
            const vecMatches: PipelineMatch[] = vecResults.map(v => {
              const row: any = db.prepare('SELECT name, file_path, start_line, label FROM nodes WHERE id = ?').get(v.nodeId);
              return {
                name: row?.name || '',
                filePath: row?.file_path || '',
                startLine: row?.start_line || 1,
                endLine: row?.start_line || 1,
                kind: (row?.label || 'unknown') as MatchKind,
                score: v.score * 100,
                snippet: '',
                repo: repo.name,
              };
            });
            db.close();
            // RRF 融合
            const ftsForRRF = all.filter(m => m.repo === repo.name).map(m => ({ nodeId: `${m.filePath}:${m.startLine}` }));
            const vecForRRF = vecResults.map(v => ({ nodeId: v.nodeId, distance: 1 - v.score }));
            const merged = this.vs.rrfMerge(ftsForRRF, vecForRRF, 60);
            const mergedScores = new Map(merged.map(m => [m.nodeId, m.rrfScore]));
            // 合并去重
            const seen = new Set<string>();
            const combined = [...vecMatches, ...all.filter(m => m.repo === repo.name)];
            const deduped: PipelineMatch[] = [];
            for (const m of combined) {
              const key = `${m.filePath}:${m.startLine}`;
              if (seen.has(key)) continue;
              seen.add(key);
              deduped.push({ ...m, score: m.score + (mergedScores.get(`${m.filePath}:${m.startLine}`) || 0) });
            }
            // 替换该仓库的结果
            all = [...all.filter(m => m.repo !== repo.name), ...deduped];
          } catch {}
        }
      } catch {}
    }

    // ── 调用图传播重打分（可选增强） ──
    // 取 Top-3 结果，沿调用关系图传播分数到调用者/被调用者
    const topN = 3;
    const decay = 0.15;
    const rescored = all.slice(0, topN).filter(m => m.name);
    for (const seed of rescored) {
      const repoInfo = repos.find(r => r.name === seed.repo);
      try {
        const [callerText, calleeText] = await Promise.all([
          this.rawCallers(seed.name!, repoInfo),
          this.rawCallees(seed.name!, repoInfo),
        ]);
        const callers = this.parseResults(callerText, seed.repo || '');
        const callees = this.parseResults(calleeText, seed.repo || '');
        const neighbors = [...callers, ...callees];
        for (const n of neighbors) {
          const match = all.find(m => m.filePath === n.filePath && m.startLine === n.startLine);
          if (match) {
            match.score += seed.score * decay;
          }
        }
      } catch {}
    }

    return all.sort((a, b) => b.score - a.score).slice(0, 20);
  }

  /** Parse codebase-memory-mcp search_graph JSON output into PipelineMatch[] */
  private parseResults(rawText: string, repoName: string): PipelineMatch[] {
    if (!rawText) return [];

    // 先尝试 JSON 解析（codebase-memory-mcp 输出）
    if (rawText.startsWith('{')) {
      try {
        const data = JSON.parse(rawText);
        // search_graph BM25 模式: data.results[]
        if (Array.isArray(data.results)) {
          return data.results.map((r: any) => ({
            name: r.name || '',
            filePath: r.file_path || r.file || '',
            startLine: r.start_line || 1,
            endLine: r.end_line || r.start_line || 1,
            kind: this.classifyCbmKind(r.label || r.kind || ''),
            score: r.rank !== undefined ? Math.round(100 + r.rank) : 60,
            snippet: '',
            repo: repoName,
          }));
        }
        // trace_path 输出: data.callers[] / data.callees[]
        const items = [...(data.callers || []), ...(data.callees || [])];
        if (items.length > 0) {
          return items.map((c: any) => ({
            name: c.name || '',
            filePath: c.qualified_name?.split('.').slice(2).join('/') || '',
            startLine: 1,
            endLine: 1,
            kind: 'reference' as MatchKind,
            score: Math.max(10, 100 - (c.hop || 0) * 30),
            snippet: '',
            repo: repoName,
          }));
        }
      } catch {}
    }

    // 兼容旧 markdown 格式（过渡期）
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
      }
    }

    return matches;
  }

  /** 解析 search_code（grep 模式）的 JSON 输出为 PipelineMatch[] */
  private parseGrepResults(rawText: string, repoName: string): PipelineMatch[] {
    try {
      const data = JSON.parse(rawText);
      if (!Array.isArray(data.results)) return [];
      return data.results.map((r: any) => ({
        name: r.node || path.basename(r.file || ''),
        filePath: r.file || '',
        startLine: r.start_line || 1,
        endLine: r.end_line || r.start_line || 1,
        kind: 'reference' as MatchKind,
        score: 60 - (r.in_degree || 0), // 扇入越高排名越前
        snippet: '',
        repo: repoName,
      }));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════
  //  两阶段搜索 — 候选列表、筛选、深读
  // ═══════════════════════════════════════════════════

  /**
   * 把第一轮搜索结果构造成结构化候选列表，供 LLM 筛选。
   * 每组 = 文件 + 命中关键词 + 代码片段（LLM 据此判断相关性）。
   */
  private buildCandidateList(matches: PipelineMatch[]): string {
    const fileMap = new Map<string, { repo: string; lines: number; snippets: string[] }>();
    for (const m of matches) {
      if (!m.filePath) continue;
      const key = `${m.repo || ''}:${m.filePath}`;
      if (!fileMap.has(key)) fileMap.set(key, { repo: m.repo || '', lines: 0, snippets: [] });
      const entry = fileMap.get(key)!;
      entry.lines = Math.max(entry.lines, m.endLine || m.startLine || 0);
      const snippet = m.snippet || (m.name ? `${m.name}` : '');
      if (snippet && !entry.snippets.includes(snippet.slice(0, 80))) {
        entry.snippets.push(snippet.slice(0, 80));
      }
    }

    const lines: string[] = ['## 候选文件列表（第一轮搜索）'];
    for (const [key, entry] of fileMap) {
      const [repo, ...fileParts] = key.split(':');
      const filePath = fileParts.join(':');
      lines.push(`### ${filePath}  (${repo})  ~${entry.lines}行`);
      for (const s of entry.snippets.slice(0, 6)) {
        lines.push(`  ${s}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * LLM 筛选：从候选列表中选出最相关的文件，并建议第二轮搜索词。
   * 模仿程序员"看到结果→想到新词"的迭代过程。
   */
  private async filterCandidates(question: string, candidates: string): Promise<{
    selectedFiles: { filePath: string; repo: string }[];
    newTerms: string[];
  } | null> {
    if (!this.llm || candidates.length < 50) return null;
    try {
      const res = await fetch(this.llm.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.llm.apiKey },
        body: JSON.stringify({
          model: this.llm.model,
          messages: [
            {
              role: 'system',
              content: `你是一个代码搜索助手。第一轮搜索后得到了候选文件列表。你的任务是：
1. 选出最需要深度阅读的 3-5 个源代码文件
2. 提出新的第二轮搜索关键词

规则：
- 只从候选列表中选
- **优先选源代码文件**（.ts/.js/.py/.go/.rs/.cpp 等），跳过文档（.md）、日志、配置文件等
- 优先选特征明显的核心模块文件（如含 Handler/Pipeline/Flow/Task/Assistant 等），跳过通用工具文件
- newTerms 必须是代码片段中出现过的函数名/类名

返回 JSON 格式：
{"selectedFiles":[{"filePath":"src/view/SomeHandler.ts","repo":"kcode"}],"newTerms":["newSearchTerm"],"reasoning":"..."}`
            },
            { role: 'user', content: `问题：${question}\n\n${candidates}` },
          ],
          max_tokens: 300,
          temperature: 0.3,
          thinking: { type: 'disabled' },
        }),
      });
      if (!res.ok) { console.log('[qa]   ▸ filterCandidates HTTP', res.status); return null; }
      const data = await res.json() as any;
      const msg = data?.choices?.[0]?.message || {};
      const text = msg.content || msg.reasoning_content || '';
      if (!text) { console.log('[qa]   ▸ filterCandidates empty response'); return null; }
      // 提取 JSON
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const jsonStr = start >= 0 && end > start ? text.slice(start, end + 1) : text;
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.selectedFiles) && !Array.isArray(parsed.newTerms)) return null;
      console.log('[qa]   ▸ filterCandidates:', JSON.stringify({
        files: parsed.selectedFiles?.length || 0,
        selected: (parsed.selectedFiles || []).map((f: any) => f.filePath),
        newTerms: parsed.newTerms,
      }));
      return {
        selectedFiles: parsed.selectedFiles || [],
        newTerms: (parsed.newTerms || []).filter((t: string) => t.length >= 2),
      };
    } catch (e: any) {
      console.log('[qa]   ▸ filterCandidates error:', e?.message?.slice(0, 100));
      return null;
    }
  }

  /**
   * 并行深读选中文件：定位关键定义区域而非只读文件头。
   * 策略：grep 找关键定义（class/interface/function/async）及其上下文，
   * 覆盖核心逻辑所在区域而非仅仅是 import 区域。
   */
  private async deepReadFiles(
    files: { filePath: string; repo: string }[],
    repos: RepoInfo[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const tasks = files.map(async (f) => {
      const repo = repos.find(r => r.name === f.repo || r.storagePath?.includes(f.repo));
      if (!repo || !repo.storagePath) return;

      const fullPath = path.join(repo.storagePath, f.filePath);
      const snippets: string[] = [];

      // 1) get_code_snippet 按符号名读
      const baseName = path.basename(f.filePath).replace(/\.[^.]+$/, '');
      const ctx = await this.rawContext(baseName, repo).catch(() => '');
      if (ctx) snippets.push(ctx.slice(0, 1200));

      // 2) 找关键定义区域（class/interface/export/async function）并读上下文
      try {
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        const lines = fileContent.split('\n');
        const defRe = /^\s*(export\s+)?(class|interface|type|enum|async|function|private|public)\s+\w/;
        const defLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (defRe.test(lines[i])) defLines.push(i);
        }

        // 从每个定义行往前取 2 行注释，往后取 10 行内容
        for (const dl of defLines.slice(0, 8)) {
          const start = Math.max(0, dl - 2);
          const end = Math.min(lines.length, dl + 12);
          const block = lines.slice(start, end).join('\n');
          if (!snippets.some(s => s.includes(block.slice(0, 60)))) {
            snippets.push(block);
          }
        }

        // 如果没有任何定义匹配，就取中间 80 行作为兜底
        if (defLines.length === 0 && lines.length > 120) {
          const mid = Math.floor(lines.length / 2);
          const fallback = lines.slice(mid - 40, mid + 40).join('\n');
          snippets.push(`// 文件中部 ${mid - 40 + 1}-${mid + 40} 行\n${fallback}`);
        }
      } catch {}

      if (snippets.length > 0) result.set(f.filePath, snippets.join('\n\n---\n\n').slice(0, 4000));
    });
    await Promise.all(tasks);
    return result;
  }

  /** Map codebase-memory-mcp label to internal MatchKind */
  private classifyCbmKind(label: string): MatchKind {
    const k = (label || '').toLowerCase();
    if (['function', 'method', 'class', 'interface', 'type', 'enum'].includes(k)) return 'definition';
    if (['variable', 'property', 'field', 'parameter'].includes(k)) return 'declaration';
    return 'reference';
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

  /** 多规则匹配 + 置信度打分 */
  private classifyIntentWithScore(question: string): { intent: Intent; score: number } {
    const q = question.trim();
    let best: Intent = 'what-is';
    let bestPriority = -1;
    let matchedCount = 0;
    let totalPatterns = 0;

    for (const rule of INTENT_MAP) {
      const matched = rule.patterns.filter(p => p.test(q));
      totalPatterns += rule.patterns.length;
      if (matched.length > 0 && rule.priority > bestPriority) {
        best = rule.intent;
        bestPriority = rule.priority;
        matchedCount = Math.max(matchedCount, matched.length);
      }
    }

    // 置信度 = 匹配到的规则比例 × 优先级因子
    const priorityFactor = Math.min(1, (bestPriority + 1) / 6);
    const matchRatio = totalPatterns > 0 ? matchedCount / Math.max(1, totalPatterns / INTENT_MAP.length) : 0;
    const score = Math.min(0.95, Math.max(0.2, (matchRatio * 0.5 + priorityFactor * 0.5)));

    return { intent: best, score };
  }

  /** LLM 分类——返回 intent + scope + english_query，异常时返回 null */
  private async classifyByLLM(question: string, repoDescs: string[], history?: string): Promise<{ intent: Intent; scope: string; english_query?: string } | null> {
    if (!this.llm) return null;
    const hasChinese = /[一-鿿]/.test(question);
    const repoInfo = repoDescs.length > 0
      ? `可用仓库：\n${repoDescs.map(r => `- ${r}`).join('\n')}`
      : '';
    try {
      const res = await fetch(this.llm.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.llm.apiKey },
        body: JSON.stringify({
          model: this.llm.model,
          messages: [
            { role: 'system', content: `你是一个代码意图分析师。根据问题和可用仓库，返回 JSON 格式：

意图（intent）：what-is（功能解释）| where-is（定位）| how-to（用法）| why-error（排错）| what-structure（架构）| what-impact（影响分析）

范围（scope）：single（只搜提问中提到的仓库）| cross-compare（跨库对比）| cross-call（跨库调用链）| global-search（全库搜索）

${repoInfo}${hasChinese ? '\n\n问题包含中文，请额外提供 english_query 字段：从中提取对代码搜索有用的英文关键词，空格分隔。不要完整句子翻译，只输出能匹配代码符号名的关键词（如"小助手"→"assistant helper"，"任务流"→"task workflow flow"）。' : ''}

返回格式：{"intent":"what-is","scope":"single","reasoning":"问题提到 flask，锁定单库"${hasChinese ? ',"english_query":"kcode assistant task workflow"（只输关键词空格分隔）' : ''}}` +
  (history ? `\n\n历史对话：\n${history}` : '') },
            { role: 'user', content: question },
          ],
          max_tokens: 200,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      try {
        const parsed = JSON.parse(text);
        const validIntents: Intent[] = ['what-is', 'where-is', 'how-to', 'why-error', 'what-structure', 'what-impact'];
        const intent = validIntents.find(i => parsed.intent?.includes(i));
        if (!intent) return null;
        return { intent, scope: parsed.scope || 'single', english_query: parsed.english_query };
      } catch {
        return null;
      }
    } catch {
      return null;
    }
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

  /**
   * 从问题中提取中文短语作为额外搜索词。
   * 英文符号正则对中文不可见，需要单独提取。
   * 问题 "kcode中小助手和任务流的区别" → ["小助手", "任务流"]
   */
  private extractChinesePhrases(question: string): string[] {
    const phrases: string[] = [];
    // 匹配 2+ 连续中文字符序列
    const matches = question.match(/[一-鿿㐀-䶿豈-﫿]{2,}/g);
    if (!matches) return phrases;
    for (const seq of matches) {
      // 按常见中文虚词拆分，获取独立概念短语
      const parts = seq.split(/[的和与及或而但并以及还有、]/);
      for (const part of parts) {
        const trimmed = part.trim();
        // 过滤单字 + 通用疑问词
        if (trimmed.length >= 2 && !['什么', '如何', '怎么', '哪个', '为什么', '是否', '这个', '那个', '区别', '差异', '不同'].includes(trimmed)) {
          if (!phrases.includes(trimmed)) phrases.push(trimmed);
        }
      }
    }
    return phrases.slice(0, 3); // 最多 3 个中文短语
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

    // 【中文支持】在英文符号之外，额外提取中文概念短语作为搜索词
    // extractSymbols() 的正则只匹配英文标识符，中文短语对其不可见
    const chinesePhrases = this.extractChinesePhrases(question);
    terms.push(...chinesePhrases);

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

/**
 * 搜索范围分类 — 独立函数，qa-endpoint.ts 可直接调用
 */
export function classifyScopeRule(question: string, allRepos: string[]): ScopeResult {
  const q = question.toLowerCase();
  const matchedRepos = allRepos.filter(r => q.includes(r.toLowerCase()));
  const repoCount = matchedRepos.length;

  // 1. 问题中提到了多个仓库 → cross-compare
  if (repoCount >= 2) {
    return { scope: 'cross-compare', repos: matchedRepos, reasoning: `提及 ${repoCount} 个仓库：${matchedRepos.join(', ')}` };
  }

  // 2. 有明确仓库名 → single（优先级高于关键词规则）
  if (repoCount === 1) {
    return { scope: 'single', repos: matchedRepos, reasoning: `问题提到 ${matchedRepos[0]}，锁定单库` };
  }

  // 3. 影响/调用链 关键词 → impact / cross-call
  if (/影响|改了|改了.*会|调用链|call\s+chain|impact|谁在调用|改了.*影响/.test(q)) {
    return { scope: 'impact', repos: allRepos, reasoning: '影响分析' };
  }

  // 4. 对比类关键词 → cross-compare
  if (/对比|区别|差异|区别|不同|vs|比较|difference|different/.test(q)) {
    return { scope: 'cross-compare', repos: allRepos, reasoning: '对比分析' };
  }

  // 5. 多库交叉引用
  if (reasonIncludesCrossRepo(q)) {
    return { scope: 'cross-call', repos: allRepos, reasoning: '可能存在跨库引用' };
  }

  // 6. 模糊搜索关键词 → global-search
  if (/有没有|哪些|哪里[^定]|where|search|find|怎么.*实现|如何.*实现/.test(q)) {
    return { scope: 'global-search', repos: allRepos, reasoning: '全局模糊搜索' };
  }

  // 7. 默认单库
  return { scope: 'single', repos: allRepos.slice(0, 1), reasoning: '默认单库' };
}
