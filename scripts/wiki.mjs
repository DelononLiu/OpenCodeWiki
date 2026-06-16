#!/usr/bin/env node
/**
 * Generate wiki for a repository using GitNexus.
 * Automatically runs `gitnexus analyze` if the index doesn't exist yet.
 *
 * Usage:
 *   node scripts/wiki.mjs <repo-path> [--force] [--lang zh|en]
 *
 * Examples:
 *   node scripts/wiki.mjs ~/Code/myproject
 *   node scripts/wiki.mjs ~/Code/myproject --force
 *   node scripts/wiki.mjs ~/Code/myproject --lang zh
 *
 * --lang zh: 生成后通过 LLM 将 Wiki 翻译为中文
 * Prerequisites:
 *   - gitnexus CLI installed (npm install -g gitnexus)
 *   - LLM configured (OPENAI_API_KEY or ~/.opencodewiki/config.json)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

function loadLlmConfig() {
  // Priority: env var > config file > defaults
  const cfgPath = path.join(os.homedir(), '.opencodewiki', 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {}

  return {
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || cfg.apiKey || '',
    baseUrl: process.env.LLM_BASE_URL || cfg.baseUrl || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || cfg.model || 'gpt-4o-mini',
  };
}

async function translateWithLLM(text, llmConfig, targetLang) {
  if (!text || !text.trim()) return text;
  const langName = targetLang === 'zh' ? '中文' : 'English';
  const url = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    ...(llmConfig.apiKey.startsWith('sk-')
      ? { Authorization: 'Bearer ' + llmConfig.apiKey }
      : { 'api-key': llmConfig.apiKey }),
  };

  // Markdown-aware translation prompt: keep code blocks, file paths, symbols unchanged
  const prompt = `You are a professional technical document translator. Translate the following Markdown wiki content to ${langName}.

Rules:
- Keep all code blocks (\`\`\`) and inline code (\`) unchanged — do NOT translate code.
- Keep file paths, URLs, and symbol names (function/class/variable names) unchanged.
- Keep Markdown formatting (headings, lists, tables, links) intact.
- Translate prose and comments naturally. Use technical terms consistently.
- Output ONLY the translated Markdown, no explanations.

Content to translate:
${text}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 16384,
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`  ✗ LLM API error (${res.status}): ${errText.slice(0, 200)}`);
      return text;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    console.error(`  ✗ LLM request failed: ${err.message}`);
    return text;
  }
}

const repoPath = process.argv[2];
const force = process.argv.includes('--force');
const langIdx = process.argv.indexOf('--lang');
const targetLang = langIdx >= 0 && process.argv[langIdx + 1] ? process.argv[langIdx + 1] : 'en';

if (!repoPath) {
  console.error('Usage: node scripts/wiki.mjs <repo-path> [--force] [--lang zh|en]');
  process.exit(1);
}

const resolvedPath = resolvePath(repoPath);
const gitnexusDir = path.join(resolvedPath, '.gitnexus');
const outputDir = path.join(resolvedPath, '.codegraph', 'wiki');
const metaPath = path.join(gitnexusDir, 'meta.json');

(async () => {
  // Step 1: gitnexus analyze if index doesn't exist
  if (!fs.existsSync(metaPath)) {
    console.log(`[1/3] No GitNexus index found. Running gitnexus analyze...`);
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
  console.log(`[2/3] Generating wiki...`);
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

    // Step 4: Translate if --lang zh
    if (targetLang === 'zh' && fs.existsSync(outputDir)) {
      const llmConfig = loadLlmConfig();
      if (!llmConfig.apiKey) {
        console.log('\n  ⚠ No LLM API key found, skipping translation. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json');
      } else {
        console.log(`\n[3/3] Translating wiki to 中文 (${llmConfig.model})...`);
        const mdFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.md'));
        for (const file of mdFiles) {
          const filePath = path.join(outputDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          process.stdout.write(`  Translating ${file}...`);
          const translated = await translateWithLLM(content, llmConfig, 'zh');
          fs.writeFileSync(filePath, translated, 'utf-8');
          console.log(' ✓');
        }
        console.log(`  ✓ All ${mdFiles.length} pages translated`);
      }
    }

    console.log('\n✓ Wiki generated successfully');
    console.log(`  View at: http://localhost:4747/${path.basename(resolvedPath)}`);
  } catch (err) {
    console.error(`✗ Wiki generation failed: ${err.message}`);
    process.exit(1);
  }
})();
