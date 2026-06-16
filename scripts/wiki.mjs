#!/usr/bin/env node
/**
 * CLI script to generate wiki for a repository using GitNexus.
 *
 * Usage:
 *   node scripts/wiki.mjs <repo-path> [--force]
 *
 * Examples:
 *   node scripts/wiki.mjs ~/Code/myproject
 *   node scripts/wiki.mjs ~/Code/myproject --force
 *
 * Prerequisites:
 *   - gitnexus CLI installed (npm install -g gitnexus)
 *   - `gitnexus analyze` has been run on the repo first
 *   - LLM configured (OPENAI_API_KEY or ~/.gitnexus/config.json)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoPath = process.argv[2];
const force = process.argv.includes('--force');

if (!repoPath) {
  console.error('Usage: node scripts/wiki.mjs <repo-path> [--force]');
  process.exit(1);
}

const resolvedPath = path.resolve(repoPath);

// Check for gitnexus index first
const metaPath = path.join(resolvedPath, '.gitnexus', 'meta.json');
if (!fs.existsSync(metaPath)) {
  console.error(`✗ No GitNexus index found at ${resolvedPath}`);
  console.error('  Run `gitnexus analyze` first to index this repository.');
  process.exit(1);
}

const args = ['wiki', resolvedPath];
if (force) args.push('--force');

console.log(`Generating wiki for: ${resolvedPath}`);
console.log('');

try {
  execFileSync('gitnexus', args, {
    timeout: 600_000,
    stdio: 'inherit',
  });
} catch (err) {
  console.error(`✗ Wiki generation failed: ${err.message}`);
  process.exit(1);
}
