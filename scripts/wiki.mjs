#!/usr/bin/env node
/**
 * CLI script to generate wiki for a repository.
 *
 * Usage:
 *   node scripts/wiki.mjs <repo-path> [--force]
 *
 * Examples:
 *   node scripts/wiki.mjs ~/Code/myproject
 *   node scripts/wiki.mjs ~/Code/myproject --force
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.resolve(__dirname, 'crg-wiki.py');
const repoPath = process.argv[2];
const force = process.argv.includes('--force');

if (!repoPath) {
  console.error('Usage: node scripts/wiki.mjs <repo-path> [--force]');
  process.exit(1);
}

const outputDir = path.join(path.resolve(repoPath), '.codegraph', 'wiki');
const args = [bridge, path.resolve(repoPath), outputDir];
if (force) args.push('--force');

console.log(`Generating wiki for: ${repoPath}`);
console.log(`Output: ${outputDir}`);
console.log('');

try {
  const stdout = execFileSync('python3', args, {
    timeout: 600_000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf-8',
  });

  // Parse the last JSON line
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const result = JSON.parse(lines[i]);
      if (result.success) {
        console.log(`✓ Wiki generated: ${result.total} pages (${result.generated} new, ${result.updated} updated)`);
        console.log(`  Pages: ${result.output_dir}`);
        process.exit(0);
      } else {
        if (result.needs_build) {
          console.log('  CRG index not found, building... (this may take a few minutes)');
          // The bridge script will handle this, but we already got the result
          // Actually let's just re-run since the first run triggered the build
          continue;
        }
        console.error(`✗ Failed: ${result.error}`);
        process.exit(1);
      }
    } catch { /* skip non-JSON lines (build progress) */ }
  }
  console.error('✗ No JSON result from bridge script');
  console.error('stdout:', stdout.slice(0, 1000));
  process.exit(1);
} catch (err) {
  console.error(`✗ Error: ${err.message}`);
  process.exit(1);
}
