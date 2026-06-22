#!/usr/bin/env node
/**
 * eval/report.mjs — 生成 MD 对比报告，追加到 METRICS.md
 *
 * 用法:
 *   node scripts/eval/report.mjs                         # latest vs baseline
 *   node scripts/eval/report.mjs -v                      # 含逐题详情
 *   node scripts/eval/report.mjs <run1> <run2>            # 自定义对比
 *   node scripts/eval/report.mjs --update-metrics         # 追加到 METRICS.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const METRICS_FILE = path.join(__dirname, 'METRICS.md');

function loadResult(label) {
  if (!label) return null;
  const filePath = path.join(RESULTS_DIR, label.endsWith('.json') ? label : `${label}.json`);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }

function delta(current, baseline) {
  const diff = current - baseline;
  const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
  return `${sign} ${pct(Math.abs(diff))}`;
}

function renderSummary(latest, baseline, showDetail) {
  const lines = [];
  const setName = latest.set || 'tiny';
  lines.push(`## ${setName.toUpperCase()} — ${latest.timestamp.slice(0, 10)}`);
  lines.push('');
  lines.push('| 指标 | 当前 | 基线 | 变化 |');
  lines.push('|------|------|------|------|');
  lines.push(`| Recall@5 | ${pct(latest.aggregated.avgRecall5)} | ${baseline ? pct(baseline.aggregated.avgRecall5) : '-'} | ${baseline ? delta(latest.aggregated.avgRecall5, baseline.aggregated.avgRecall5) : '-'} |`);
  lines.push(`| Recall@10 | ${pct(latest.aggregated.avgRecall10)} | ${baseline ? pct(baseline.aggregated.avgRecall10) : '-'} | ${baseline ? delta(latest.aggregated.avgRecall10, baseline.aggregated.avgRecall10) : '-'} |`);
  lines.push(`| MRR | ${latest.aggregated.avgMrr.toFixed(4)} | ${baseline ? baseline.aggregated.avgMrr.toFixed(4) : '-'} | ${baseline ? delta(latest.aggregated.avgMrr, baseline.aggregated.avgMrr) : '-'} |`);
  lines.push(`| Pass@5 | ${latest.aggregated.passCount}/${latest.aggregated.total} | ${baseline ? `${baseline.aggregated.passCount}/${baseline.aggregated.total}` : '-'} | ${baseline ? `${latest.aggregated.passCount - baseline.aggregated.passCount > 0 ? '▲' : latest.aggregated.passCount - baseline.aggregated.passCount < 0 ? '▼' : '—'} ${Math.abs(latest.aggregated.passCount - baseline.aggregated.passCount)}` : '-'} |`);
  lines.push('');

  if (showDetail) {
    lines.push('### 逐题详情\n');
    lines.push('| ID | Intent | 通过 | Recall@5 | MRR | 命中符号 |');
    lines.push('|----|--------|------|----------|-----|---------|');
    for (const r of latest.results) {
      const pass = r.metrics.recall5 > 0 ? '✅' : '❌';
      const hits = r.metrics.hitDetails?.symbols
        ? Object.entries(r.metrics.hitDetails.symbols).map(([k, v]) => `${k}@${v}`).join(', ') : '-';
      lines.push(`| ${r.id} | ${r.intent} | ${pass} | ${(r.metrics.recall5 * 100).toFixed(0)}% | ${r.metrics.mrr.toFixed(3)} | ${hits} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function updateMetricsFile(latest, baseline) {
  const entry = [
    `| ${latest.timestamp.slice(0, 10)} | ${latest.set || 'tiny'} | ${pct(latest.aggregated.avgRecall5)} | ${pct(latest.aggregated.avgRecall10)} | ${latest.aggregated.avgMrr.toFixed(4)} | ${latest.aggregated.passCount}/${latest.aggregated.total} |`,
  ].join('');

  let content;
  try {
    content = fs.readFileSync(METRICS_FILE, 'utf-8');
    // Find the table body and insert new row
    const lines = content.split('\n');
    const insertIdx = lines.findLastIndex(l => l.startsWith('| 20')) + 1;
    lines.splice(insertIdx, 0, entry);
    content = lines.join('\n');
  } catch {
    content = `# 评测指标历史\n\n| 日期 | 迭代 | Recall@5 | Recall@10 | MRR | Pass@5 |\n|------|------|----------|-----------|-----|--------|\n| **基线** | **baseline** | **${pct(latest.aggregated.avgRecall5)}** | **${pct(latest.aggregated.avgRecall10)}** | **${latest.aggregated.avgMrr.toFixed(4)}** | **${latest.aggregated.passCount}/${latest.aggregated.total}** |\n`;
    // Add the new row (baseline already there, so skip)
    if (baseline) {
      content = content + entry + '\n';
    }
  }
  fs.writeFileSync(METRICS_FILE, content);
  console.log(`指标历史已更新: ${METRICS_FILE}`);
}

function main() {
  const args = process.argv.slice(2);
  const updateMetrics = args.includes('--update-metrics') || args.includes('-m');

  const baseline = loadResult('baseline') || loadResult('tiny-baseline');
  const latest = args.includes('--show') || args.includes('-v')
    ? loadResult('latest')
    : loadResult(args[0]) || loadResult('latest');

  if (!latest) {
    console.error('没有找到最新结果。先跑: npm run eval:qa tiny');
    process.exit(1);
  }

  const showDetail = args.includes('--show') || args.includes('-v');
  const report = renderSummary(latest, baseline, showDetail);
  console.log(report);

  if (updateMetrics) {
    updateMetricsFile(latest, baseline);
  }
}

main();
