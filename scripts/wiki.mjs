#!/usr/bin/env node
/**
 * Generate wiki for a repository using GitNexus.
 * Automatically runs `gitnexus analyze` if the index doesn't exist yet.
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
 *   - LLM configured (OPENAI_API_KEY or ~/.gitnexus/config.json)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

const repoPath = process.argv[2];
const force = process.argv.includes('--force');

if (!repoPath) {
  console.error('Usage: node scripts/wiki.mjs <repo-path> [--force]');
  process.exit(1);
}

const resolvedPath = resolvePath(repoPath);
const gitnexusDir = path.join(resolvedPath, '.gitnexus');
const outputDir = path.join(resolvedPath, '.codegraph', 'wiki');
const metaPath = path.join(gitnexusDir, 'meta.json');

// Step 1: gitnexus analyze if index doesn't exist
if (!fs.existsSync(metaPath)) {
  console.log(`[1/2] No GitNexus index found. Running gitnexus analyze...`);
  console.log(`     Path: ${resolvedPath}`);
  console.log('');
  try {
    execFileSync('gitnexus', ['analyze', resolvedPath], {
      timeout: 600_000,
      stdio: 'inherit',
      cwd: resolvedPath,
    });
    console.log('  ✓ Index complete\n');
  } catch (err) {
    console.error(`✗ gitnexus analyze failed: ${err.message}`);
    console.error('  Make sure gitnexus is installed: npm install -g gitnexus');
    process.exit(1);
  }
}

// Step 2: Generate wiki
console.log(`[2/2] Generating wiki...`);
console.log('');

const args = ['wiki', resolvedPath];
if (force) args.push('--force');

try {
  execFileSync('gitnexus', args, {
    timeout: 600_000,
    stdio: 'inherit',
    cwd: resolvedPath,
  });

  // Step 3: Copy to .codegraph/wiki/
  const srcDir = path.join(gitnexusDir, 'wiki');
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, file);
      const dst = path.join(outputDir, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
    console.log(`  ✓ Copied to ${outputDir}`);
  }

  console.log('\n✓ Wiki generated successfully');
  console.log(`  View at: http://localhost:4747/${path.basename(resolvedPath)}/wiki`);
} catch (err) {
  console.error(`✗ Wiki generation failed: ${err.message}`);
  process.exit(1);
}
