#!/usr/bin/env node
/**
 * Generate wiki for a repository using GitNexus.
 * Automatically runs `gitnexus analyze` if the index doesn't exist yet.
 *
 * Usage:
 *   node scripts/wiki.mjs <repo-path> [--force] [--lang zh|en] [--extra-pages]
 *
 * Examples:
 *   node scripts/wiki.mjs ~/Code/myproject
 *   node scripts/wiki.mjs ~/Code/myproject --force
 *   node scripts/wiki.mjs ~/Code/myproject --lang zh
 *   node scripts/wiki.mjs ~/Code/myproject --extra-pages     # 额外生成 external-api / core / hot-modules
 *
 * --lang zh:       生成后通过 LLM 将 Wiki 翻译为中文
 * --extra-pages:   自动扫描代码生成 外部API、Core、热点模块 页面
 * Prerequisites:
 *   - gitnexus CLI installed (npm install -g gitnexus)
 *   - LLM configured (OPENAI_API_KEY or ~/.opencodewiki/config.json)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';

function resolvePath(p) {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

function loadLlmConfig() {
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

async function callLLM(prompt, llmConfig, maxTokens = 4096) {
  const url = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    ...(llmConfig.apiKey.startsWith('sk-')
      ? { Authorization: 'Bearer ' + llmConfig.apiKey }
      : { 'api-key': llmConfig.apiKey }),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`  ✗ LLM API error (${res.status}): ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`  ✗ LLM request failed: ${err.message}`);
    return null;
  }
}

async function translateWithLLM(text, llmConfig, targetLang) {
  if (!text || !text.trim()) return text;
  const langName = targetLang === 'zh' ? '中文' : 'English';
  const prompt = `You are a professional technical document translator. Translate the following Markdown wiki content to ${langName}.

Rules:
- Keep all code blocks (\`\`\`) and inline code (\`) unchanged — do NOT translate code.
- Keep file paths, URLs, and symbol names (function/class/variable names) unchanged.
- Keep Markdown formatting (headings, lists, tables, links) intact.
- Translate prose and comments naturally. Use technical terms consistently.
- Output ONLY the translated Markdown, no explanations.

Content to translate:
${text}`;

  const result = await callLLM(prompt, llmConfig, 16384);
  return result || text;
}

// ── Code scanning helpers ─────────────────────────────────────

function scanExportedSymbols(repoPath) {
  /** Find exported top-level symbols: functions, classes, interfaces, types, consts */
  const codeExts = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/;
  const results = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'target' || e.name === '__pycache__') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (codeExts.test(e.name)) results.push(full);
    }
  }
  walk(repoPath);

  const symbols = [];
  for (const file of results) {
    const rel = path.relative(repoPath, file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match export statements
        const m = line.match(/^\s*export\s+(default\s+)?(function|class|interface|type|const|let|var|enum|abstract\s+class|async\s+function)\s+(\w+)/);
        if (m) {
          symbols.push({ file: rel, line: i + 1, kind: m[2], name: m[3] });
        }
      }
    } catch {}
  }
  return symbols;
}

function scanDependencyGraph(repoPath) {
  /** Count how many times each module is imported */
  const codeExts = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/;
  const imports = {}; // modulePath -> importCount

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'target' || e.name === '__pycache__') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (codeExts.test(e.name)) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          // Match import/require statements and extract the module path
          const importRe = /(?:import\s+(?:[\w*{}, ]+\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
          let m;
          while ((m = importRe.exec(content)) !== null) {
            const mod = m[1] || m[2];
            if (mod.startsWith('.')) {
              // Resolve relative path to a module name
              const dir2 = path.dirname(full);
              const resolved = path.resolve(dir2, mod);
              const rel = path.relative(repoPath, resolved).replace(/\\/g, '/');
              imports[rel] = (imports[rel] || 0) + 1;
            }
          }
        } catch {}
      }
    }
  }
  walk(repoPath);

  // Sort by import count descending
  return Object.entries(imports)
    .map(([mod, count]) => ({ module: mod, count }))
    .sort((a, b) => b.count - a.count);
}

function scanHotFiles(repoPath) {
  /** Find recently/modified files (git log or mtime) */
  const hotFiles = [];

  // Try git log first
  try {
    const output = execSync('git log --oneline --name-only --pretty=format: -n 50', {
      cwd: repoPath,
      timeout: 10000,
      encoding: 'utf-8',
    });
    const freq = {};
    for (const file of output.split('\n')) {
      const f = file.trim();
      if (f && !f.startsWith('.') && !f.includes('node_modules') && !f.includes('dist/')) {
        freq[f] = (freq[f] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .map(([file, changes]) => ({ file, changes }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 20);
  } catch {
    // Fallback: use mtime
    const codeExts = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift|md|json|yml|yaml|toml)$/;
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'target' || e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (codeExts.test(e.name)) {
          const stat = fs.statSync(full);
          hotFiles.push({ file: path.relative(repoPath, full), mtime: stat.mtimeMs });
        }
      }
    }
    walk(repoPath);
    hotFiles.sort((a, b) => b.mtime - a.mtime);
    return hotFiles.slice(0, 20).map(f => ({ file: f.file, changes: 0 }));
  }
}

// ── Page generation ───────────────────────────────────────────

async function generateExternalApi(repoPath, outputDir, llmConfig, lang) {
  const symbols = scanExportedSymbols(repoPath);
  if (symbols.length === 0) {
    console.log('  ⚠ No exported symbols found, skipping external-api');
    return false;
  }

  // Group by directory for structure
  const groups = {};
  for (const s of symbols) {
    const dir = path.dirname(s.file);
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(s);
  }

  const summary = Object.entries(groups).map(([dir, syms]) => {
    return `## ${dir || '.'}\n${syms.map(s => `- \`${s.name}\` (${s.kind}) — ${s.file}:${s.line}`).join('\n')}`;
  }).join('\n\n');

  const sampleCode = symbols.slice(0, 5).map(s => {
    try {
      const content = fs.readFileSync(path.join(repoPath, s.file), 'utf-8');
      const lines = content.split('\n');
      return `### ${s.name} (${s.file}:${s.line})\n\`\`\`\n${lines.slice(Math.max(0, s.line - 1), s.line + 15).join('\n')}\n\`\`\``;
    } catch { return ''; }
  }).filter(Boolean).join('\n\n');

  const langHint = lang === 'zh' ? '用中文撰写' : '';
  const prompt = `You are a technical writer. Generate a developer-facing API reference document for the following project.

Below are the exported symbols (functions, classes, interfaces, etc.) found in the codebase, organized by directory:

${summary}

Sample source code for the top exports:
${sampleCode}

${langHint}
Generate a well-structured Markdown document that:
1. Lists and describes each exported symbol with its signature and purpose
2. Groups related symbols together
3. Documents parameters, return values, and side effects where applicable
4. Includes brief code usage examples where helpful
5. Uses ## headings for groups, ### headings for individual symbols
6. Output ONLY the Markdown content, no extra explanation`;

  console.log('  Generating external-api...');
  const result = await callLLM(prompt, llmConfig, 16384);
  if (result) {
    fs.writeFileSync(path.join(outputDir, 'external-api.md'), result, 'utf-8');
    console.log('  ✓ external-api.md generated');
    return true;
  }
  return false;
}

async function generateCore(repoPath, outputDir, llmConfig, lang) {
  const deps = scanDependencyGraph(repoPath);
  if (deps.length === 0) {
    console.log('  ⚠ No dependency data found, skipping core');
    return false;
  }

  const topModules = deps.slice(0, 15);
  const summary = topModules.map(d => `- \`${d.module}\` — imported ${d.count} times`).join('\n');

  // For the top 5 modules, read their file content for context
  const samples = [];
  for (const d of topModules.slice(0, 5)) {
    const filePath = path.join(repoPath, d.module);
    // Try common extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '/index.ts', '/index.js']) {
      const fp = d.module.endsWith(ext) ? filePath : filePath + ext;
      try {
        if (fs.existsSync(fp)) {
          const content = fs.readFileSync(fp, 'utf-8');
          const lines = content.split('\n');
          samples.push(`### ${d.module}\n\`\`\`\n${lines.slice(0, 30).join('\n')}\n\`\`\``);
          break;
        }
      } catch {}
    }
  }

  const langHint = lang === 'zh' ? '用中文撰写' : '';
  const prompt = `You are a technical writer. Analyze the following dependency graph and source code to explain the **core modules** of this project.

Import frequency (most imported modules):
${summary}

Source code samples:
${samples.join('\n\n')}

${langHint}
Generate a Markdown document that:
1. Identifies the 3-5 most central modules and explains their role
2. Shows how they relate to each other (dependency patterns)
3. Describes why each is foundational (highly reused, provides core abstractions, etc.)
4. Uses ## headings for each module
5. Output ONLY the Markdown content`;

  console.log('  Generating core...');
  const result = await callLLM(prompt, llmConfig, 8192);
  if (result) {
    fs.writeFileSync(path.join(outputDir, 'core.md'), result, 'utf-8');
    console.log('  ✓ core.md generated');
    return true;
  }
  return false;
}

async function generateHotModules(repoPath, outputDir, llmConfig, lang) {
  const hotFiles = scanHotFiles(repoPath);
  if (hotFiles.length === 0) {
    console.log('  ⚠ No modification data found, skipping hot-modules');
    return false;
  }

  const summary = hotFiles.map(f => `- \`${f.file}\`${f.changes > 0 ? ` — ${f.changes} changes in recent commits` : ' — recently modified'}`).join('\n');

  const langHint = lang === 'zh' ? '用中文撰写' : '';
  const prompt = `You are a technical writer. Analyze which parts of this codebase change most frequently, based on commit history.

Most frequently modified files:
${summary}

${langHint}
Generate a Markdown document that:
1. Lists the top "hot modules" — areas of the codebase that see the most churn
2. For each hot module, explains what it does and why it might change often (new features, bug fixes, refactoring)
3. Highlights any risk patterns (high churn could indicate instability or evolving requirements)
4. Uses ## headings for each module
5. Output ONLY the Markdown content`;

  console.log('  Generating hot-modules...');
  const result = await callLLM(prompt, llmConfig, 8192);
  if (result) {
    fs.writeFileSync(path.join(outputDir, 'hot-modules.md'), result, 'utf-8');
    console.log('  ✓ hot-modules.md generated');
    return true;
  }
  return false;
}

// ── Codegraph Data Helpers ─────────────────────────────────────

/** Query codegraph DB for call edges between files. Returns { caller, callee } pairs. */
function queryCallEdges(db) {
  // 跨文件 calls: source file path ← node → target file path
  const rows = db.prepare(`
    SELECT n1.file_path AS caller, n2.file_path AS callee, COUNT(*) AS count
    FROM edges e
    JOIN nodes n1 ON e.source = n1.id
    JOIN nodes n2 ON e.target = n2.id
    WHERE e.kind IN ('calls', 'imports', 'references')
      AND n1.file_path != n2.file_path
    GROUP BY n1.file_path, n2.file_path
    ORDER BY count DESC
  `).all();
  return rows;
}

/** Get exported symbols per file from codegraph DB. */
function queryExportsByFile(db) {
  const rows = db.prepare(`
    SELECT file_path, name, kind FROM nodes WHERE is_exported = 1 ORDER BY file_path, name
  `).all();
  const map = {};
  for (const r of rows) {
    if (!map[r.file_path]) map[r.file_path] = [];
    map[r.file_path].push({ name: r.name, kind: r.kind });
  }
  return map;
}

/** Get all source files (excluding generated/config). */
function querySourceFiles(db) {
  return db.prepare("SELECT path FROM files WHERE path NOT LIKE 'node_modules/%' AND path NOT LIKE '.%' AND path NOT LIKE 'dist/%' AND path NOT LIKE 'target/%'").all();
}

/** Build a file-list string for LLM grouping prompt. */
function formatFileListForGrouping(files, exportsByFile) {
  const lines = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '__pycache__', 'vendor', 'scripts']);
  for (const f of files) {
    const parts = f.path.split('/');
    if (SKIP_DIRS.has(parts[0])) continue;
    const exps = exportsByFile[f.path];
    if (exps && exps.length > 0) {
      const syms = exps.map(e => `${e.name}(${e.kind})`).join(', ');
      lines.push(`- ${f.path}: ${syms}`);
    } else {
      lines.push(`- ${f.path}`);
    }
  }
  return lines.join('\n');
}

/** Call LLM with JSON mode — expects a JSON object response. */
async function callLLMJson(prompt, llmConfig, systemPrompt) {
  const url = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    ...(llmConfig.apiKey.startsWith('sk-')
      ? { Authorization: 'Bearer ' + llmConfig.apiKey }
      : { 'api-key': llmConfig.apiKey }),
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a code analysis assistant. Always respond with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`  ✗ LLM API error (${res.status}): ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    console.error(`  ✗ LLM request failed: ${err.message}`);
    return null;
  }
}

// ── Codegraph Wiki Generation ──────────────────────────────────

/** Generate module_tree.json with LLM grouping + edge data. */
async function generateModuleTree(repoPath, outputDir, llmConfig) {
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) {
    console.log('  ⚠ codegraph.db not found, skipping module tree');
    return null;
  }

  const db = new DatabaseSync(dbPath);
  const files = querySourceFiles(db);
  const exportsByFile = queryExportsByFile(db);
  const edges = queryCallEdges(db);
  db.close();

  let moduleMap = null;

  // Try LLM-based grouping if LLM is configured
  if (llmConfig && llmConfig.apiKey) {
    console.log('  Grouping files by functionality (LLM)...');
    const fileList = formatFileListForGrouping(files, exportsByFile);
    const groupingPrompt = `Analyze these source files and group them into functional modules (5-20 modules).
Group by functionality, not by directory — put files that serve the same purpose together.
Files that are configuration, documentation, or build-related can be grouped as "Infrastructure".

Available files:
${fileList}

Return JSON: { "modules": { "ModuleName": ["path/file1.ts", "path/file2.ts", ...] } }
Module names should be short and descriptive (e.g. "Authentication", "API Gateway", "Data Storage").`;

    const systemPrompt = 'You are a code architecture analyst. Group source files by their functional role in the project. Respond only with valid JSON.';
    const result = await callLLMJson(groupingPrompt, llmConfig, systemPrompt);
    if (result && result.modules) {
      moduleMap = result.modules;
    } else {
      console.log('  ⚠ LLM grouping failed, falling back to directory grouping');
    }
  }

  // Fallback: directory-based grouping
  if (!moduleMap) {
    moduleMap = {};
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '__pycache__', 'vendor']);
    for (const f of files) {
      const parts = f.path.split('/');
      const topDir = parts.length >= 2 && !SKIP_DIRS.has(parts[0]) ? parts[0] : null;
      if (topDir) {
        if (!moduleMap[topDir]) moduleMap[topDir] = [];
        moduleMap[topDir].push(f.path);
      }
    }
  }

  // Build module tree with dependency info from edges
  const tree = [];
  const moduleNames = Object.keys(moduleMap).sort();
  for (const name of moduleNames) {
    const modFiles = moduleMap[name];
    // Calculate dependencies (outgoing calls to other modules)
    const depSet = new Set();
    const depBySet = new Set();
    const fileSet = new Set(modFiles);
    for (const e of edges) {
      if (fileSet.has(e.caller)) {
        // Find which module the callee belongs to
        for (const [mName, mFiles] of Object.entries(moduleMap)) {
          if (mName !== name && mFiles.includes(e.callee)) {
            depSet.add(mName);
            break;
          }
        }
      }
      if (fileSet.has(e.callee)) {
        for (const [mName, mFiles] of Object.entries(moduleMap)) {
          if (mName !== name && mFiles.includes(e.caller)) {
            depBySet.add(mName);
            break;
          }
        }
      }
    }
    tree.push({
      name,
      slug: slugify(name),
      files: modFiles,
      dependencies: [...depSet].sort(),
      dependents: [...depBySet].sort(),
      children: [],
    });
  }

  fs.writeFileSync(path.join(outputDir, 'module_tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
  console.log('  ✓ module_tree.json generated (' + tree.length + ' modules)');
  return { tree, moduleMap, exportsByFile, edges };
}

/** Generate overview.md from README + codegraph stats + module dependency. */
function generateOverview(repoPath, outputDir) {
  // Try README first
  let overview = '';
  for (const name of ['README.md', 'README', 'readme.md', 'Readme.md']) {
    const readmePath = path.join(repoPath, name);
    if (fs.existsSync(readmePath)) {
      overview = fs.readFileSync(readmePath, 'utf-8');
      break;
    }
  }

  // Append module dependency section from module_tree.json
  const treePath = path.join(outputDir, 'module_tree.json');
  if (fs.existsSync(treePath)) {
    try {
      const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
      if (tree.length > 0) {
        overview += '\n\n---\n\n## 🏗️ 架构概览\n\n';
        overview += '### 模块依赖关系\n\n```mermaid\nflowchart LR\n';
        const added = new Set();
        for (const mod of tree) {
          const modId = mod.slug.replace(/[^a-zA-Z0-9]/g, '_');
          overview += `  ${modId}[${mod.name}]\n`;
          if (mod.dependencies) {
            for (const dep of mod.dependencies) {
              const depSlug = slugify(dep).replace(/[^a-zA-Z0-9]/g, '_');
              const edge = `${modId}-->${depSlug}`;
              if (!added.has(edge)) {
                overview += `  ${edge}\n`;
                added.add(edge);
              }
            }
          }
          if (mod.dependents && mod.dependents.length === 0) {
            // Check if any module lists this as a dependency
            const isReferenced = tree.some(m => m.dependencies && m.dependencies.includes(mod.name));
            if (!isReferenced) {
              // orphaned module (no dependents, no one references it)
            }
          }
        }
        overview += '```\n\n';

        // Module table
        overview += '### 模块清单\n\n| 模块 | 文件数 | 依赖 | 被依赖 |\n|------|--------|------|--------|\n';
        for (const mod of tree) {
          const filesCount = mod.files ? mod.files.length : 0;
          const deps = mod.dependencies && mod.dependencies.length > 0 ? mod.dependencies.join(', ') : '-';
          const depBy = mod.dependents && mod.dependents.length > 0 ? mod.dependents.join(', ') : '-';
          overview += `| **${mod.name}** | ${filesCount} | ${deps} | ${depBy} |\n`;
        }
        overview += '\n';
      }
    } catch {}
  }

  // Append codegraph stats
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      const fileCount = db.prepare('SELECT COUNT(*) AS c FROM files').get();
      const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get();
      const langRows = db.prepare('SELECT language, COUNT(*) AS c FROM files WHERE language IS NOT NULL AND language != \'\' GROUP BY language ORDER BY c DESC LIMIT 5').all();
      db.close();

      let statsSection = '\n\n---\n\n## 📊 代码统计\n\n';
      statsSection += `- **文件数:** ${fileCount.c}\n`;
      statsSection += `- **符号数:** ${nodeCount.c}\n`;
      if (langRows.length > 0) {
        statsSection += '- **语言:**\n';
        for (const l of langRows) {
          statsSection += `  - ${l.language}: ${l.c} 文件\n`;
        }
      }
      overview += statsSection;
    } catch {}
  }

  fs.writeFileSync(path.join(outputDir, 'overview.md'), overview || '# Overview\n\n（暂无内容）\n', 'utf-8');
  console.log('  ✓ overview.md generated');
}

/** Read source file content, with size limit. Returns { path, code } or null. */
function readFileSnippet(repoPath, filePath, maxLines = 50) {
  const full = path.join(repoPath, filePath);
  try {
    const content = fs.readFileSync(full, 'utf-8');
    const lines = content.split('\n');
    // Return first N non-empty lines
    const snippet = lines.slice(0, maxLines).join('\n');
    return { path: filePath, totalLines: lines.length, snippet };
  } catch { return null; }
}

/** Generate a markdown page for a single module using LLM. */
async function generateModulePage(mod, repoPath, outputDir, llmConfig, exportsByFile, edges) {
  const slug = slugify(mod.name);
  const fileSnippets = [];
  let totalLines = 0;
  for (const f of mod.files.slice(0, 10)) { // Limit to 10 files per module
    const snip = readFileSnippet(repoPath, f, 30);
    if (snip) {
      fileSnippets.push(snip);
      totalLines += snip.totalLines;
    }
  }

  // Intra-module edges
  const fileSet = new Set(mod.files);
  const intraEdges = edges.filter(e => fileSet.has(e.caller) && fileSet.has(e.callee));
  const outgoingEdges = edges.filter(e => fileSet.has(e.caller) && !fileSet.has(e.callee)).slice(0, 15);
  const incomingEdges = edges.filter(e => fileSet.has(e.callee) && !fileSet.has(e.caller)).slice(0, 15);

  let sourceSection = '';
  for (const s of fileSnippets) {
    sourceSection += `--- ${s.path} (${s.totalLines} lines) ---\n${s.snippet}\n\n`;
  }

  const deps = mod.dependencies && mod.dependencies.length > 0 ? mod.dependencies.join(', ') : '无';
  const depBy = mod.dependents && mod.dependents.length > 0 ? mod.dependents.join(', ') : '无（入口层）';

  const prompt = `Generate a developer documentation page for the module "${mod.name}".

## Module Info
- **Files:** ${mod.files.join(', ')}
- **Depends on:** ${deps}
- **Used by:** ${depBy}

## Source Code Snippets
${sourceSection}

## Call Relationships (from codegraph)
${intraEdges.length > 0 ? 'Intra-module calls:\n' + intraEdges.map(e => `- ${e.caller} → ${e.callee}`).join('\n') : '（无内部调用）'}
${outgoingEdges.length > 0 ? '\nOutgoing calls (to other modules):\n' + outgoingEdges.map(e => `- ${e.caller} → ${e.callee}`).join('\n') : ''}
${incomingEdges.length > 0 ? '\nIncoming calls (from other modules):\n' + incomingEdges.map(e => `- ${e.caller} → ${e.callee}`).join('\n') : ''}

Write a Markdown document that includes:
1. **Module purpose** — what this module does and why it exists
2. **Core symbols** — key exports (functions, classes, interfaces) with brief descriptions
3. **Dependencies** — how it connects to other modules
4. **Key flows** — if the call edges suggest a data flow or execution path, describe it

Output ONLY the Markdown content. Use Chinese for all prose.`;

  const content = await callLLM(prompt, llmConfig, 8192);
  if (content) {
    const md = `# ${mod.name}\n\n${content}\n`;
    fs.writeFileSync(path.join(outputDir, `${slug}.md`), md, 'utf-8');
    console.log(`  ✓ ${slug}.md`);
    return true;
  }
  return false;
}

/** Generate markdown pages for all modules (parallel, limited concurrency). */
async function generateModulePages(result, repoPath, outputDir, llmConfig) {
  const { tree, moduleMap, exportsByFile, edges } = result;
  let count = 0;
  const promises = [];
  for (const mod of tree) {
    // Wait for concurrency limit (3 parallel)
    while (promises.length >= 3) {
      await promises.shift();
    }
    const p = generateModulePage(mod, repoPath, outputDir, llmConfig, exportsByFile, edges)
      .then(ok => { if (ok) count++; });
    promises.push(p);
  }
  await Promise.all(promises);
  console.log(`  ✓ ${count}/${tree.length} module pages generated`);
}

/** Generate data-model.md from codegraph nodes with kind=interface/type/class. */
function generateDataModelPage(repoPath, outputDir) {
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) return;

  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`
    SELECT name, kind, file_path, signature, docstring,
      (SELECT COUNT(*) FROM edges e JOIN nodes n2 ON e.target = n2.id WHERE n2.name = nodes.name AND n2.file_path = nodes.file_path) AS refs
    FROM nodes
    WHERE kind IN ('interface', 'class') AND is_exported = 1
    ORDER BY refs DESC LIMIT 40
  `).all();
  db.close();

  if (rows.length === 0) return;

  const groups = {};
  for (const r of rows) {
    const dir = r.file_path.split('/')[0];
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(r);
  }

  let md = '# 📐 数据结构设计\n\n核心 interface 和 class 定义，按模块分组。\n\n';
  for (const [dir, items] of Object.entries(groups)) {
    md += `## ${dir}\n\n`;
    md += '| 名称 | 类型 | 文件 | 引用次数 | 签名 |\n';
    md += '|------|------|------|----------|------|\n';
    for (const item of items) {
      const sig = (item.signature || '').slice(0, 80);
      const doc = item.docstring ? item.docstring.slice(0, 60).replace(/\n/g, ' ') : '';
      md += `| \`${item.name}\` | ${item.kind} | \`${item.file_path}\` | ${item.refs} | ${doc || sig} |\n`;
    }
    md += '\n';
  }

  fs.writeFileSync(path.join(outputDir, 'data-model.md'), md, 'utf-8');
  console.log('  ✓ data-model.md generated');
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

// ── Main ──────────────────────────────────────────────────────

const repoPath = process.argv[2];
const force = process.argv.includes('--force');
const extraPages = process.argv.includes('--extra-pages');
const withModules = process.argv.includes('--modules');
const langIdx = process.argv.indexOf('--lang');
const targetLang = langIdx >= 0 && process.argv[langIdx + 1] ? process.argv[langIdx + 1] : 'en';

if (!repoPath) {
  console.error('Usage: node scripts/wiki.mjs <repo-path> [--force] [--lang zh|en] [--extra-pages] [--modules]');
  console.error('  --modules: 同时生成每个模块的 markdown 页面（需要 LLM 配置）');
  process.exit(1);
}

const resolvedPath = resolvePath(repoPath);
const outputDir = path.join(resolvedPath, '.codegraph', 'wiki');
const codegraphDb = path.join(resolvedPath, '.codegraph', 'codegraph.db');
const pagesDir = path.join(resolvedPath, '.codegraph', 'wiki');

(async () => {
  const totalSteps = extraPages ? 4 : 2;
  let step = 1;

  // Step 1: Check codegraph index exists
  if (!fs.existsSync(codegraphDb)) {
    console.log(`[${step}/${totalSteps}] No codegraph index found at ${codegraphDb}`);
    console.log('  Please run codegraph index first: cd <repo> && npx codegraph index');
    console.log('  Or use: npm run index -- <repo-path>\n');
    process.exit(1);
  }
  console.log(`[${step}/${totalSteps}] ✓ codegraph index found`);
  step++;

  // Step 2: Generate wiki from codegraph DB
  console.log(`[${step}/${totalSteps}] Generating wiki from codegraph data...`);
  console.log('');
  step++;

  try {
    const llmConfig = loadLlmConfig();
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await generateModuleTree(resolvedPath, outputDir, llmConfig);
    generateDataModelPage(resolvedPath, outputDir);
    await generateOverview(resolvedPath, outputDir);

    // Generate module pages if --modules flag is set
    if (withModules && result && result.tree && llmConfig.apiKey) {
      console.log(`\n[${step}/${totalSteps}] Generating module pages...`);
      await generateModulePages(result, resolvedPath, outputDir, llmConfig);
    }
    if (withModules && !llmConfig.apiKey) {
      console.log('  ⚠ --modules requires LLM API key. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json');
    }

    // Step 3: Translate if --lang zh
    if (targetLang === 'zh' && fs.existsSync(outputDir)) {
      const llmConfig = loadLlmConfig();
      if (!llmConfig.apiKey) {
        console.log('\n  ⚠ No LLM API key found, skipping translation. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json');
      } else {
        console.log(`\n[${step}/${totalSteps}] Translating wiki to 中文 (${llmConfig.model})...`);
        step++;
        const mdFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.md') && !f.match(/^(external-api|core|hot-modules)\.md$/));
        for (const file of mdFiles) {
          const filePath = path.join(outputDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          process.stdout.write(`  Translating ${file}...`);
          const translated = await translateWithLLM(content, llmConfig, 'zh');
          fs.writeFileSync(filePath, translated, 'utf-8');
          console.log(' ✓');
        }
        console.log(`  ✓ ${mdFiles.length} pages translated`);
      }
    }

    // Step 4: Generate extra pages
    if (extraPages) {
      console.log(`\n[${step}/${totalSteps}] Generating extra pages...`);
      const llmConfig = loadLlmConfig();
      if (!llmConfig.apiKey) {
        console.log('  ⚠ No LLM API key found, skipping extra pages. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json');
      } else {
        console.log('');
        await generateExternalApi(resolvedPath, outputDir, llmConfig, targetLang);
        await generateCore(resolvedPath, outputDir, llmConfig, targetLang);
        await generateHotModules(resolvedPath, outputDir, llmConfig, targetLang);
      }
    }

    console.log('\n✓ Wiki generated successfully');
    console.log(`  View at: http://localhost:4747/${path.basename(resolvedPath)}`);
  } catch (err) {
    console.error(`✗ Wiki generation failed: ${err.message}`);
    process.exit(1);
  }
})();
