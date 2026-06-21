#!/usr/bin/env node
/**
 * Re-index a repo already registered in OpenCodeWiki.
 *
 * Usage:
 *   npm run reindex -- <repo-name-or-path>           # 全量重新索引
 *   npm run reindex --watch <repo-name-or-path>       # 监听模式：文件变更自动增量同步
 *   npm run reindex --hook <repo-name-or-path>        # git post-merge hook（安静模式）
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

function repoPathToProjectName(p) {
  return p.replace(/^\//, '').replace(/\//g, '-');
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
  try {
    const out = execFileSync('codebase-memory-mcp', ['cli', 'index_status',
      JSON.stringify({ project: repoPathToProjectName(rp) }),
    ], { encoding: 'utf-8', timeout: 30_000 });
    const jsonLine = out.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
    const data = JSON.parse(jsonLine);
    if (data.status !== 'ready') {
      console.error(`✗ Repo not indexed at ${rp}. Run 'npm run index' first.`);
      process.exit(1);
    }
  } catch {
    console.error(`✗ codebase-memory-mcp not available or repo not indexed at ${rp}.`);
    process.exit(1);
  }
}

function fastSync(rp) {
  execFileSync('codebase-memory-mcp', ['cli', 'index_repository',
    JSON.stringify({ repo_path: rp, mode: 'fast' }),
  ], { stdio: 'inherit', timeout: 120_000, cwd: rp });
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
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`[watch] 变更: ${rel}`);
        try {
          fastSync(repoPath);
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
  // ── Git hook 模式（安静） ──
  const resolved = resolveRepo(input);
  repoPath = resolved.path; repoName = resolved.name;
  if (!fs.existsSync(repoPath)) process.exit(1);
  try {
    execFileSync('codebase-memory-mcp', ['cli', 'index_repository',
      JSON.stringify({ repo_path: repoPath, mode: 'fast' }),
    ], { stdio: 'pipe', timeout: 120_000, cwd: repoPath });
  } catch {}
  process.exit(0);

} else {
  // ── 全量重新索引 ──
  const resolved = resolveRepo(input);
  repoPath = resolved.path; repoName = resolved.name;
  if (!fs.existsSync(repoPath)) { console.error(`✗ Repo not found: ${repoPath}`); process.exit(1); }
  ensureReady(repoPath);

  console.log(`Re-indexing: ${repoName}`);
  console.log(`  Path: ${repoPath}`);
  console.log('');

  try {
    const before = execFileSync('codebase-memory-mcp', ['cli', 'index_status',
      JSON.stringify({ project: repoPathToProjectName(repoPath) }),
    ], { encoding: 'utf-8', timeout: 30_000 });
    const jsonLine = before.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
    const data = JSON.parse(jsonLine);
    if (data.nodes) console.log(`  Before: ${data.nodes} nodes, ${data.edges} edges`);
  } catch {}

  execFileSync('codebase-memory-mcp', ['cli', 'index_repository',
    JSON.stringify({ repo_path: repoPath, mode: 'full' }),
  ], { stdio: 'inherit', timeout: 600_000, cwd: repoPath });
  console.log('  ✓ Re-index complete');

  try {
    const after = execFileSync('codebase-memory-mcp', ['cli', 'index_status',
      JSON.stringify({ project: repoPathToProjectName(repoPath) }),
    ], { encoding: 'utf-8', timeout: 30_000 });
    const jsonLine = after.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
    const data = JSON.parse(jsonLine);
    console.log(`  After: ${data.nodes} nodes, ${data.edges} edges`);
  } catch {}

  updateRegistry(repoPath);
}
