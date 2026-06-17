#!/usr/bin/env node
/**
 * Re-index a repo already registered in OpenCodeWiki.
 *
 * Usage:
 *   npm run reindex -- <repo-name-or-path>
 *
 * Examples:
 *   npm run reindex -- kcode
 *   npm run reindex -- ~/Code/myproject
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run reindex -- <repo-name-or-path>');
  process.exit(1);
}

// Try resolving as repo name from registry, otherwise treat as path
const registryFile = path.join(os.homedir(), '.opencodewiki', 'registry.json');
let repoPath;
let repoName;

try {
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
  const entry = registry.find(r => r.name === input);
  if (entry) {
    repoPath = entry.path;
    repoName = entry.name;
  }
} catch {}

if (!repoPath) {
  repoPath = resolvePath(input);
  repoName = path.basename(repoPath);
}

if (!fs.existsSync(repoPath)) {
  console.error(`✗ Repo not found: ${repoPath}`);
  process.exit(1);
}

// Check if codegraph is initialized
const cgDir = path.join(repoPath, '.codegraph');
if (!fs.existsSync(cgDir)) {
  console.error(`✗ CodeGraph not initialized at ${repoPath}. Run 'npm run index' first.`);
  process.exit(1);
}

console.log(`Re-indexing: ${repoName}`);
console.log(`  Path: ${repoPath}`);
console.log('');

try {
  const statusBefore = execFileSync('npx', ['codegraph', 'status', repoPath], {
    encoding: 'utf-8',
    timeout: 30_000,
    cwd: repoPath,
  });
  const filesBefore = parseInt(statusBefore.match(/\*\*Files indexed:\*\*\s*(\d+)/)?.[1] || '0', 10);
  console.log(`  Before: ${filesBefore} files indexed`);
} catch {
  // status check is optional
}

console.log('');
console.log('Running codegraph index...');
try {
  execFileSync('npx', ['codegraph', 'index', repoPath], {
    stdio: 'inherit',
    timeout: 600_000,
    cwd: repoPath,
  });
  console.log('  ✓ Re-index complete');
} catch (err) {
  console.error(`  ✗ Re-index failed: ${err.message}`);
  process.exit(1);
}

// Show updated stats
try {
  const statusAfter = execFileSync('npx', ['codegraph', 'status', repoPath], {
    encoding: 'utf-8',
    timeout: 30_000,
    cwd: repoPath,
  });
  console.log('');
  console.log(statusAfter.trim());
} catch {}

// Update registry indexedAt
try {
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
  const entry = registry.find(r => r.path === repoPath);
  if (entry) {
    entry.indexedAt = new Date().toISOString();
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  }
} catch {}
