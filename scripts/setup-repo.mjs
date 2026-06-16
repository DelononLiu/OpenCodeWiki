#!/usr/bin/env node
/**
 * Initialize a repo for OpenCodeWiki: codegraph init + index + register.
 *
 * Usage:
 *   node scripts/setup-repo.mjs <repo-path> [repo-name]
 *
 * Examples:
 *   node scripts/setup-repo.mjs ~/Code/myproject
 *   node scripts/setup-repo.mjs ~/Code/myproject myproject
 *
 * Steps:
 *   1. npx codegraph init --index <path>   (creates .codegraph/ + indexes)
 *   2. Register in ~/.opencodewiki/registry.json
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

const repoPath = resolvePath(process.argv[2] || '');
let repoName = process.argv[3];

if (!repoPath) {
  console.error('Usage: node scripts/setup-repo.mjs <repo-path> [repo-name]');
  process.exit(1);
}

if (!fs.existsSync(repoPath)) {
  console.error(`✗ Path not found: ${repoPath}`);
  process.exit(1);
}

// Derive name from directory if not provided
if (!repoName) {
  repoName = path.basename(repoPath);
}

console.log(`Setting up repo: ${repoName}`);
console.log(`  Path: ${repoPath}`);
console.log('');

// Step 1: codegraph init + index
console.log('[1/2] Initializing codegraph index...');
try {
  execFileSync('npx', ['codegraph', 'init', '--index', repoPath], {
    stdio: 'inherit',
    timeout: 300_000,
    cwd: repoPath,
  });
  console.log('  ✓ codegraph init + index complete');
} catch (err) {
  console.error(`  ✗ codegraph init failed: ${err.message}`);
  process.exit(1);
}

// Step 2: Register in ~/.opencodewiki/registry.json
console.log('[2/2] Registering in OpenCodeWiki...');
const registryDir = path.join(os.homedir(), '.opencodewiki');
const registryFile = path.join(registryDir, 'registry.json');

let registry = [];
try {
  registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
} catch {
  // File doesn't exist yet — start fresh
}

// Check for duplicate
const existing = registry.find((r: any) => r.name === repoName);
if (existing) {
  existing.path = repoPath;
  console.log(`  ✓ Updated existing entry for "${repoName}"`);
} else {
  registry.push({ name: repoName, path: repoPath });
  console.log(`  ✓ Registered "${repoName}"`);
}

fs.mkdirSync(registryDir, { recursive: true });
fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf-8');

console.log('');
console.log(`Done. Repo "${repoName}" is ready for OpenCodeWiki.`);
console.log(`  Code index: ${repoPath}/.codegraph/`);
console.log(`  Registry:   ${registryFile}`);
console.log('');
console.log('Next steps:');
console.log(`  Start server:   npm run dev`);
console.log(`  Generate wiki:  npm run wiki -- ${repoPath}`);
