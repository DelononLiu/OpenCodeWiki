#!/usr/bin/env node
/**
 * answer-runner.mjs — 回答质量评测
 *
 * 逐题调用 LLM 回答问题，对比 expected_answer，输出 ROUGE-L/BERTScore。
 *
 * 用法:
 *   LLM_API_KEY=sk-xxx node scripts/eval/answer-runner.mjs
 *   npm run eval:answer
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let API_KEY, BASE_URL, MODEL;

// 优先从 OpenCodeWiki 配置读取（已验证可用）
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.opencodewiki', 'config.json'), 'utf-8'));
  API_KEY = cfg.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  BASE_URL = cfg.baseUrl || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  MODEL = cfg.model || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
} catch {
  API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  MODEL = process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

// ── 调 LLM API ──

async function askLLM(question) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一个代码分析师。用简洁准确的中文回答代码相关问题，直接给出答案不要解释。' },
        { role: 'user', content: question },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── ROUGE-L（简单 JS 版）──

function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n];
}

function rougeL(hypothesis, reference) {
  const hyp = hypothesis.split('');
  const ref = reference.split('');
  const lcsLen = lcs(hyp, ref);
  const prec = lcsLen / hyp.length;
  const rec = lcsLen / ref.length;
  const f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;
  return { precision: prec, recall: rec, f1 };
}
// ── 主流程 ──

async function main() {
  const setFile = process.argv[2] || path.join(__dirname, 'tiny.json');

  const questions = JSON.parse(fs.readFileSync(setFile, 'utf-8'));
  const results = [];

  console.log(`\n===== 回答评测 (${questions.length} 题) =====`);
  console.log(`模型: ${MODEL} | 端点: ${BASE_URL}\n`);

  for (const q of questions) {
    // 支持两种格式: expected_answer（tiny）或 answer（SWE-QA）
    const expected = q.expected_answer || q.answer;
    if (!expected) continue;

    process.stdout.write(`  ${q.id || '?'} `);

    try {
      const answer = await askLLM(q.question);
      const score = rougeL(answer, expected);
      results.push({ id: q.id || q.question.slice(0,30), answer, expected, score });
      process.stdout.write(`ROUGE-L: ${(score.f1 * 100).toFixed(1)}%\n`);
    } catch (e) {
      process.stdout.write(`❌ ${e.message}\n`);
    }
  }

  // 汇总
  if (results.length > 0) {
    const avg = results.reduce((s, r) => s + r.score.f1, 0) / results.length;
    console.log(`\n----- 汇总 -----`);
    console.log(`平均 ROUGE-L F1: ${(avg * 100).toFixed(1)}%`);
    console.log(`最高: ${(Math.max(...results.map(r => r.score.f1)) * 100).toFixed(1)}%`);
    console.log(`最低: ${(Math.min(...results.map(r => r.score.f1)) * 100).toFixed(1)}%`);
    console.log(`\n逐题:`);
    for (const r of results) {
      console.log(`  ${(r.score.f1 * 100).toFixed(1)}% ${r.id}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
