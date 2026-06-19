#!/usr/bin/env node
/**
 * Re-index a repo already registered in OpenCodeWiki.
 *
 * Usage:
 *   npm run reindex -- <repo-name-or-path>           # 全量重新索引
 *   npm run reindex --watch <repo-name-or-path>       # 监听模式：文件变更自动增量同步
 *   npm run reindex --hook <repo-name-or-path>        # git post-merge hook（安静模式）
 */

import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

const registryFile = path.join(os.homedir(), '.opencodewiki', 'registry.json');
let repoPath, repoName;

function resolveRepo(input) {
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    const entry = registry.find(r => r.name === input);
    if (entry) return entry;
  } catch {}
  const rp = resolvePath(input);
  return { path: rp, name: path.basename(rp) };
}

function ensureReady(rp) {
  if (!fs.existsSync(path.join(rp, '.codegraph'))) {
    console.error(`✗ CodeGraph not initialized at ${rp}. Run 'npm run index' first.`);
    process.exit(1);
  }
}

function codegraphSync(rp) {
  execFileSync('npx', ['codegraph', 'sync', rp], { stdio: 'inherit', timeout: 120_000, cwd: rp });
}

function updateRegistry(rp) {
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    const entry = registry.find(r => r.path === rp);
    if (entry) { entry.indexedAt = new Date().toISOString(); fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf-8'); }
  } catch {}
}

// ── 模式分发 ──

const mode = process.argv[2];
const input = process.argv[3] || process.argv[2];

if (mode === '--watch' || mode === '-w') {
  // ── 监听模式 ──
  const { watch } = await import('node:fs/promises');
  const resolved = resolveRepo(input);
  repoPath = resolved.path; repoName = resolved.name;
  if (!fs.existsSync(repoPath)) { console.error(`✗ Repo not found: ${repoPath}`); process.exit(1); }
  ensureReady(repoPath);

  console.log(`[watch] 监听中: ${repoName} (${repoPath})`);
  console.log('[watch] 文件变更后自动增量同步...\n');

  // 忽略的目录/文件模式
  const ignore = /(node_modules|\.git|dist|build|target|\.codegraph|\/\.)/;

  const ac = new AbortController();
  process.on('SIGINT', () => { console.log('\n[watch] 停止'); ac.abort(); process.exit(0); });

  try {
    const watcher = watch(repoPath, { recursive: true, signal: ac.signal });
    let timer = null;
    for await (const event of watcher) {
      if (event.eventType !== 'change') continue;
      const rel = path.relative(repoPath, event.filename || '');
      if (ignore.test(rel)) continue;
      // 防抖 1s
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`[watch] 变更: ${rel}`);
        try {
          codegraphSync(repoPath);
          console.log(`[watch] ✓ 增量同步完成`);
        } catch (e) {
          console.error(`[watch] ✗ 同步失败: ${e.message}`);
        }
      }, 1000);
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[watch] 错误:', e.message);
  }
  process.exit(0);

} else if (mode === '--hook') {
  // ── Git hook 模式（安静，只输出错误） ──
  const resolved = resolveRepo(input);
  repoPath = resolved.path; repoName = resolved.name;
  if (!fs.existsSync(repoPath)) process.exit(1);
  try { execSync(`npx codegraph sync "${repoPath}"`, { stdio: 'pipe', timeout: 120_000, cwd: repoPath }); } catch {}
  process.exit(0);

} else {
  // ── 全量重新索引（原有逻辑） ──
  const resolved = resolveRepo(input);
  repoPath = resolved.path; repoName = resolved.name;
  if (!fs.existsSync(repoPath)) { console.error(`✗ Repo not found: ${repoPath}`); process.exit(1); }
  ensureReady(repoPath);

  console.log(`Re-indexing: ${repoName}`);
  console.log(`  Path: ${repoPath}`);
  console.log('');

  try {
    const before = execFileSync('npx', ['codegraph', 'status', repoPath], { encoding: 'utf-8', timeout: 30_000, cwd: repoPath });
    const m = before.match(/\*\*Files indexed:\*\*\s*(\d+)/);
    if (m) console.log(`  Before: ${m[1]} files`);
  } catch {}

  execFileSync('npx', ['codegraph', 'index', repoPath], { stdio: 'inherit', timeout: 600_000, cwd: repoPath });
  console.log('  ✓ Re-index complete');

  try {
    const after = execFileSync('npx', ['codegraph', 'status', repoPath], { encoding: 'utf-8', timeout: 30_000, cwd: repoPath });
    console.log('');
    console.log(after.trim());
  } catch {}

  updateRegistry(repoPath);
}
