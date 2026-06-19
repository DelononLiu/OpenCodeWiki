#!/usr/bin/env node
/**
 * eval/runner.mjs — 评测运行器
 *
 * 用法:
 *   node scripts/eval/runner.mjs tiny          # 跑 tiny 集
 *   node scripts/eval/runner.mjs full          # 跑 full 集
 *   node scripts/eval/runner.mjs tiny baseline # 作为基线保存
 *
 * 输出: console 打印 + scripts/eval/results/latest.json
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────

const REGISTRY_FILE = path.join(os.homedir(), '.opencodewiki', 'registry.json');
const RESULTS_DIR = path.join(__dirname, 'results');

const evalSets = {
  tiny: path.join(__dirname, 'tiny.json'),
  // full: later when SWE-QA is adapted
};

// ── Helpers ─────────────────────────────────────────────────────────

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch { return []; }
}

function getRepoPath(name) {
  const registry = loadRegistry();
  const entry = registry.find(r => r.name === name);
  return entry ? entry.path : null;
}

function codegraphSearch(query, repoPath, limit = 10) {
  try {
    const stdout = execFileSync('codegraph', [
      'query', query,
      '--path', repoPath,
      '--limit', String(limit),
      '--json',
    ], { encoding: 'utf-8', timeout: 30000 });
    return JSON.parse(stdout);
  } catch (e) {
    console.error(`[runner] codegraph query failed: ${query}`, e.message);
    return [];
  }
}

// ── Metrics ──────────────────────────────────────────────────────────

function evaluate(searchResult, golden) {
  const symbols = golden.golden_symbols || [];
  const files = (golden.golden_files || []).map(f => {
    // Normalize: strip line numbers e.g. "src/foo.ts:42-68" -> "src/foo.ts"
    return f.split(':')[0];
  });

  const hits = { symbols: {}, files: {} };
  const results = Array.isArray(searchResult) ? searchResult : [searchResult];

  for (let rank = 0; rank < results.length; rank++) {
    const r = results[rank];
    // codegraph query --json returns [{ node: { name, filePath, ... }, score: ... }]
    const node = r.node || r;
    const name = (node.name || '').toLowerCase();
    const filePath = (node.filePath || node.file_path || '').toLowerCase();

    for (const sym of symbols) {
      if (!hits.symbols[sym] && name.includes(sym.toLowerCase())) {
        hits.symbols[sym] = rank + 1; // 1-based rank
      }
    }
    for (const f of files) {
      if (!hits.files[f] && filePath.includes(f.toLowerCase())) {
        hits.files[f] = rank + 1;
      }
    }
  }

  // Recall@5 / @10
  const found5 = [...Object.values(hits.symbols), ...Object.values(hits.files)]
    .filter(r => r <= 5).length;
  const found10 = [...Object.values(hits.symbols), ...Object.values(hits.files)]
    .filter(r => r <= 10).length;
  const total = symbols.length + files.length;

  // MRR (best of symbol or file per rank, average across all golden items)
  const reciprocalRanks = symbols.map(s => hits.symbols[s] ? 1 / hits.symbols[s] : 0)
    .concat(files.map(f => hits.files[f] ? 1 / hits.files[f] : 0));
  const mrr = reciprocalRanks.length > 0
    ? reciprocalRanks.reduce((a, b) => a + b, 0) / reciprocalRanks.length
    : 0;

  return {
    recall5: total > 0 ? found5 / total : 0,
    recall10: total > 0 ? found10 / total : 0,
    mrr,
    hitDetails: { symbols: hits.symbols, files: hits.files },
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const setArg = process.argv[2] || 'tiny';
  const isBaseline = process.argv[3] === 'baseline';

  const setFile = evalSets[setArg];
  if (!setFile) {
    console.error(`未知评测集: ${setArg}，可用: ${Object.keys(evalSets).join(', ')}`);
    process.exit(1);
  }

  const questions = JSON.parse(fs.readFileSync(setFile, 'utf-8'));
  console.log(`\n===== 评测集: ${setArg} (${questions.length} 题) =====\n`);

  const results = [];
  for (const q of questions) {
    const repoPath = getRepoPath(q.repo);
    if (!repoPath) {
      console.warn(`  ⚠ 仓库 ${q.repo} 未注册，跳过`);
      continue;
    }

    const searchResult = codegraphSearch(q.question, repoPath, 10);
    const metrics = evaluate(searchResult, q);

    results.push({ ...q, metrics });

    const status = metrics.recall5 > 0 ? '✅' : '❌';
    console.log(`  ${status} ${q.id} [${q.intent}] Recall@5:${(metrics.recall5 * 100).toFixed(0)}%  MRR:${metrics.mrr.toFixed(3)}`);
    if (metrics.hitDetails.symbols && Object.keys(metrics.hitDetails.symbols).length > 0) {
      const details = Object.entries(metrics.hitDetails.symbols)
        .map(([k, v]) => `${k}@${v}`).join(', ');
      console.log(`      符号命中: ${details}`);
    }
  }

  // Aggregated
  const validResults = results.filter(r => r.metrics !== undefined);
  const avgRecall5 = validResults.reduce((s, r) => s + r.metrics.recall5, 0) / validResults.length;
  const avgRecall10 = validResults.reduce((s, r) => s + r.metrics.recall10, 0) / validResults.length;
  const avgMrr = validResults.reduce((s, r) => s + r.metrics.mrr, 0) / validResults.length;
  const passCount = validResults.filter(r => r.metrics.recall5 > 0).length;

  console.log(`\n----- 汇总 -----`);
  console.log(`Recall@5:  ${(avgRecall5 * 100).toFixed(1)}%`);
  console.log(`Recall@10: ${(avgRecall10 * 100).toFixed(1)}%`);
  console.log(`MRR:       ${avgMrr.toFixed(4)}`);
  console.log(`Pass@5:    ${passCount}/${validResults.length}`);

  // Save results
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const tag = isBaseline ? 'baseline' : new Date().toISOString().slice(0, 10);
  const outFile = path.join(RESULTS_DIR, `${setArg}-${tag}.json`);
  const output = {
    timestamp: new Date().toISOString(),
    set: setArg,
    isBaseline,
    aggregated: { avgRecall5, avgRecall10, avgMrr, passCount, total: validResults.length },
    results: validResults,
  };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(output, null, 2));
  console.log(`\n结果已保存: ${outFile}`);
}

main().catch(e => { console.error(e); process.exit(1); });
