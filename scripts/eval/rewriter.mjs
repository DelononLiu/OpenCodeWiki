/**
 * rewriter.mjs — 查询改写（查询时使用，不重新索引）
 *
 * 对用户问题做变换，生成多个搜索词变体，提升 FTS5 命中率。
 * 驼峰拆词 + 词形还原 + 代码用语标准化
 */

// ── camelCase / snake_case 拆分 ──

/**
 * 将驼峰命名拆为单词
 * "multiRepoSsearch" → ["multi", "repo", "ssearch"]
 * "QaResolver" → ["qa", "resolver"]
 * "classifyDomain" → ["classify", "domain"]
 */
function splitCamelCase(word) {
  const parts = [];
  // 先按大写字母拆分：QaResolver → Qa, Resolver
  let current = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch >= 'A' && ch <= 'Z' && current.length > 0) {
      parts.push(current.toLowerCase());
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current.toLowerCase());
  return parts;
}

// ── 代码用语词典 ──

const SYNONYMS = {
  'auth': ['authentication', 'login'],
  'config': ['configuration', 'setup', 'setting'],
  'delete': ['remove', 'del'],
  'create': ['add', 'new', 'make', 'generate'],
  'find': ['search', 'query', 'get', 'lookup'],
  'update': ['modify', 'change', 'edit', 'set', 'put'],
  'fetch': ['load', 'get', 'retrieve', 'pull'],
  'validate': ['check', 'verify', 'ensure'],
  'util': ['utility', 'helper', 'tool'],
  'init': ['initialize', 'setup', 'start'],
  'err': ['error', 'exception', 'fail'],
};

/**
 * 对用户问题生成多个搜索词变体
 * @param {string} question
 * @returns {string[]} 搜索词列表（原词 + 所有变体）
 */
export function rewrite(question) {
  const words = question.split(/[\s,?!.]+/).filter(w => w.length > 1);
  const variants = new Set(words);

  for (const word of words) {
    const lower = word.toLowerCase();

    // 1. 驼峰拆词
    const hasUpper = /[A-Z]/.test(word);
    if (hasUpper) {
      const parts = splitCamelCase(word);
      const joined = parts.join(' ');
      variants.add(joined);
      for (const p of parts) variants.add(p);
    }

    // 2. 蛇形拆词
    if (lower.includes('_')) {
      const parts = lower.split('_');
      const joined = parts.join(' ');
      variants.add(joined);
      for (const p of parts) variants.add(p);
    }

    // 3. 词形还原（简单规则）
    const stemmed = stem(word);
    if (stemmed !== word) variants.add(stemmed);

    // 4. 同义词
    const syns = SYNONYMS[lower] || SYNONYMS[stemmed];
    if (syns) for (const s of syns) variants.add(s);
  }

  return [...variants].filter(w => w.length > 1);
}

/**
 * 简单词形还原
 */
function stem(word) {
  const w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);    // searching → search
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);     // queried → quer
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y'; // queries → query
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);     // classes → class
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1); // tokens → token
  return w;
}

// ── CLI 测试 ──
if (process.argv[1]?.endsWith('rewriter.mjs')) {
  const q = process.argv[2] || 'How are cross-repo queries searched across multiple repositories';
  const r = rewrite(q);
  console.log('原句:', q);
  console.log('变体:', r.join(', '));
}
