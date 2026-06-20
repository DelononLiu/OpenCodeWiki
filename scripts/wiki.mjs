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
 * --lang zh:       extra-pages 时使用中文（LLM prompts 已内置中文输出）
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
  // Use codegraph DB exported symbols instead of regex
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) {
    console.log('  ⚠ codegraph.db not found, skipping external-api');
    return false;
  }

  const db = new DatabaseSync(dbPath);
  const symbols = db.prepare(`
    SELECT name, kind, file_path, signature, docstring,
      (SELECT COUNT(*) FROM edges e JOIN nodes n2 ON e.target = n2.id WHERE n2.name = nodes.name) AS refs
    FROM nodes WHERE is_exported = 1 AND kind IN ('function', 'method', 'class', 'interface', 'type', 'const', 'variable')
    ORDER BY refs DESC LIMIT 30
  `).all();
  db.close();

  if (symbols.length === 0) {
    console.log('  ⚠ No exported symbols found in codegraph, skipping external-api');
    return false;
  }

  // Group by top-level directory
  const groups = {};
  for (const s of symbols) {
    const dir = s.file_path.split('/')[0];
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(s);
  }

  const summary = Object.entries(groups).map(([dir, syms]) => {
    const items = syms.map(s =>
      `### ${s.name}\n- **kind:** ${s.kind}\n- **file:** ${s.file_path}\n- **signature:** \`${(s.signature || s.name).slice(0, 120)}\`\n- **docstring:** ${(s.docstring || '-').slice(0, 300)}\n- **references:** ${s.refs}\n`
    ).join('\n');
    return `## ${dir}\n${items}`;
  }).join('\n\n');

  const langHint = lang === 'zh' ? '请用中文输出，所有说明文字使用中文。' : '';
  const prompt = `Write an API reference document. Follow the template for EACH exported symbol:

## {File/Directory Group}

### {symbolName}
**签名:** \`{signature}\`
**用途:** (1-2 sentences on what this function/class does and when to use it)
**参数:** (list key parameters from the signature)
**返回值:** (from signature or context)

## Data
${summary}

${langHint}
Output ONLY the formatted API reference. Do not add extra commentary.`;

  console.log('  Generating external-api...');
  const result = await callLLM(prompt, llmConfig, 8192);
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

/** Build module_tree.json from architecture modules (identified by overview) + codegraph file mapping.
 *  Uses codegraph edges to determine dependencies between modules. */
async function buildModuleTree(repoPath, outputDir, moduleNames) {
  if (!moduleNames || moduleNames.length === 0) {
    console.log('  ⚠ No modules identified, skipping module tree');
    return [];
  }

  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  const tree = [];

  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const allFiles = db.prepare("SELECT path FROM files WHERE path NOT LIKE 'node_modules/%' AND path NOT LIKE '.%'").all();
    // Assign files to modules: try name matching first, fall back to directory grouping
    const modFiles = {};
    for (const name of moduleNames) {
      modFiles[name] = [];
      const nameLower = name.toLowerCase();
      // Extract potential keyword from Chinese module name (e.g. "代码提取引擎" → "extraction")
      // For English module names, use direct matches
      for (const f of allFiles) {
        const fileLower = f.path.toLowerCase();
        if (fileLower.includes(nameLower)) {
          modFiles[name].push(f.path);
        }
      }
    }

    // Fallback: any unmapped modules use directory grouping
    const mappedFiles = new Set(Object.values(modFiles).flat());
    const unmapped = allFiles.filter(f => !mappedFiles.has(f.path));
    const idx = 0; // assign round-robin to modules that still have room
    for (const name of moduleNames) {
      if (modFiles[name].length === 0) {
        // Assign files whose top-level directory matches a module name keyword
        const nameParts = name.toLowerCase().split(/[\s\-_/]+/);
        for (const f of unmapped) {
          const parts = f.path.split('/');
          for (const p of parts) {
            if (nameParts.some(np => p.includes(np) || np.includes(p))) {
              if (p.length > 2) { // avoid single-char matches
                modFiles[name].push(f.path);
                break;
              }
            }
          }
        }
      }
    }

    // If still empty, distribute remaining files evenly
    const stillEmpty = moduleNames.filter(n => modFiles[n].length === 0);
    if (stillEmpty.length > 0) {
      const remaining = allFiles.filter(f => !Object.values(modFiles).flat().includes(f.path));
      let ri = 0;
      for (const name of stillEmpty) {
        // Take a fair share
        const share = Math.ceil(remaining.length / stillEmpty.length);
        modFiles[name] = remaining.slice(ri, ri + share).map(f => f.path);
        ri += share;
      }
    }

    // Compute dependencies from codegraph edges
    const edges = db.prepare(`
      SELECT n1.file_path AS caller, n2.file_path AS callee
      FROM edges e JOIN nodes n1 ON e.source = n1.id JOIN nodes n2 ON e.target = n2.id
      WHERE e.kind IN ('calls','imports','references') AND n1.file_path != n2.file_path
    `).all();
    db.close();

    for (const name of moduleNames) {
      const files = modFiles[name] || [];
      const fileSet = new Set(files);
      const depSet = new Set();
      const depBySet = new Set();
      for (const e of edges) {
        if (fileSet.has(e.caller)) {
          for (const [n2, f2] of Object.entries(modFiles)) {
            if (n2 !== name && f2.includes(e.callee)) { depSet.add(n2); break; }
          }
        }
        if (fileSet.has(e.callee)) {
          for (const [n2, f2] of Object.entries(modFiles)) {
            if (n2 !== name && f2.includes(e.caller)) { depBySet.add(n2); break; }
          }
        }
      }
      tree.push({
        name,
        slug: slugify(name),
        files: files.length > 0 ? files : [`(${name} — no files auto-mapped)`],
        dependencies: [...depSet].sort(),
        dependents: [...depBySet].sort(),
      });
    }
  } else {
    // No codegraph DB: use module names as-is
    for (const name of moduleNames) {
      tree.push({ name, slug: slugify(name), files: [], dependencies: [], dependents: [] });
    }
  }

  fs.writeFileSync(path.join(outputDir, 'module_tree.json'), JSON.stringify(tree, null, 2), 'utf-8');
  console.log('  ✓ module_tree.json generated (' + tree.length + ' modules from architecture)');
  return tree;
}

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

/** Generate overview.md with LLM using fixed template + codegraph data.
 *  Returns array of identified module names for building module_tree.json. */
async function generateOverview(repoPath, outputDir, llmConfig) {
  // Stage 1: Gather data (no module tree dependency)
  let readme = '';
  for (const name of ['README.md', 'README', 'readme.md', 'Readme.md']) {
    const p = path.join(repoPath, name);
    if (fs.existsSync(p)) { readme = fs.readFileSync(p, 'utf-8').slice(0, 2000); break; }
  }

  let stats = { files: 0, nodes: 0, lang: [] };
  let allFiles = [];
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      stats.files = db.prepare('SELECT COUNT(*) AS c FROM files').get().c;
      stats.nodes = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
      stats.lang = db.prepare("SELECT language, COUNT(*) AS c FROM files WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC LIMIT 5").all();
      stats.topExports = db.prepare("SELECT name, kind, file_path, (SELECT COUNT(*) FROM edges e JOIN nodes n2 ON e.target = n2.id WHERE n2.name = nodes.name) AS refs FROM nodes WHERE is_exported = 1 ORDER BY refs DESC LIMIT 20").all();
      allFiles = db.prepare("SELECT path FROM files WHERE path NOT LIKE 'node_modules/%' AND path NOT LIKE '.%'").all();
      db.close();
    } catch {}
  }

  let identifiedModNames = [];
  const topFiles = allFiles.slice(0, 50).map(f => f.path).join('\n');
  const topExports = stats.topExports ? stats.topExports.slice(0, 15).map(e => e.name + ' (' + e.kind + ') @ ' + e.file_path).join('\n') : '';

  // Stage 2: LLM generates overview with module identification
  const prompt = `为一个代码库编写项目概览文档。严格按以下模板结构输出，不要增删章节。

## 项目简介
（2-3 句话：这个项目是做什么的，核心定位）

## 业务流程
（用 mermaid 流程图展示核心业务流，从用户触发到完成的完整链路。图下方加 2-3 句文字说明。）

\`\`\`mermaid
flowchart TD
  （在此处描述业务步骤，使用 basic 风格，不要任何 CSS 样式、颜色、class 定义）
\`\`\`

## 架构分层
（用 mermaid 图展示模块间的依赖/调用关系，配合 2-3 句文字说明各层职责。）

\`\`\`mermaid
flowchart LR
  （在此处描述模块关系，使用 basic 风格，不要任何 CSS 样式、颜色、class 定义）
\`\`\`

## 核心模块
（列出最重要的 3-6 个模块，每个模块 1-2 句话说明职责）

## 技术栈
（1-2 句话，基于下方数据简述主要用的语言和技术）

数据：
README 片段：${readme ? readme.slice(0, 500) : '（无）'}
语言统计：${stats.lang.map(l => l.language + '(' + l.c + ' 文件)').join('、')}
文件总数：${stats.files}，符号总数：${stats.nodes}
主要导出符号：
${topExports}
Top 文件列表：
${topFiles}

输出要求：
1. 只输出模板中的内容
2. 所有文字使用中文
3. 在文档末尾添加一行：<!-- MODULES: 模块1, 模块2, 模块3 -->（列出核心模块部分提到的所有模块名）`;

  let md = '';

  if (llmConfig && llmConfig.apiKey) {
    const content = await callLLM(prompt, llmConfig, 8192);
    if (content) {
      md = content;
      const modMatch = content.match(/<!-- MODULES:\s*(.+?)\s*-->/);
      if (modMatch) {
        identifiedModNames.push(...modMatch[1].split(',').map(s => s.trim()).filter(Boolean));
        md = md.replace(/<!-- MODULES:.+?-->/, '');
      } else {
        const cmMatch = content.match(/### 核心模块\n([\s\S]*?)(?=\n###|$)/);
        if (cmMatch) {
          for (const line of cmMatch[1].split('\n')) {
            const m = line.match(/^- \*\*(.+?)\*\*/);
            if (m) identifiedModNames.push(m[1]);
          }
        }
      }
    }
  }

  if (!md) {
    md = readme ? readme + '\n\n---\n' : '';
    const dirs = new Set();
    for (const f of allFiles) {
      const parts = f.path.split('/');
      if (parts.length >= 2) dirs.add(parts[0]);
    }
    identifiedModNames.push(...[...dirs].filter(d => !['node_modules', '.git', 'dist'].includes(d)).sort());
  }

  // Stats section
  md += '\n\n---\n\n## 📊 代码统计\n\n';
  md += '- **文件数:** ' + stats.files + '\n- **符号数:** ' + stats.nodes + '\n';
  if (stats.lang.length > 0) {
    md += '- **语言:**\n';
    for (const l of stats.lang) md += '  - ' + l.language + ': ' + l.c + ' 文件\n';
  }

  fs.writeFileSync(path.join(outputDir, 'overview.md'), md, 'utf-8');
  console.log('  \u2713 overview.md generated (' + identifiedModNames.length + ' modules identified)');
  return identifiedModNames;
}
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

  const prompt = `Generate a documentation page for module "${mod.name}". Follow the template EXACTLY.

## Fixed Template

### 职责
(2-3 sentences explaining what this module does and why it exists)

### 核心符号

| 符号 | 类型 | 说明 |
|------|------|------|
| (List key exported functions, classes, interfaces with brief 1-line descriptions) |

### 依赖关系

- **依赖:** ${deps}
- **被依赖:** ${depBy}

(1-2 sentences on how this module connects to others)

### 关键流程
(If call edges reveal a data flow, describe in 2-3 sentences. Otherwise: "无显著流程。")

## Data
Files: ${mod.files.join(', ')}
Source snippets:
${sourceSection}
Intra-module calls: ${intraEdges.length > 0 ? intraEdges.map(e => e.caller + ' → ' + e.callee).join(', ') : '无'}
Outgoing: ${outgoingEdges.length > 0 ? outgoingEdges.map(e => e.caller + ' → ' + e.callee).join(', ') : '无'}
Incoming: ${incomingEdges.length > 0 ? incomingEdges.map(e => e.caller + ' → ' + e.callee).join(', ') : '无'}

严格按模板输出。只输出内容，不添加额外章节。所有文字使用中文。`;

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

/** Generate data-model.md with LLM per-group descriptions + field table. */
async function generateDataModelPage(repoPath, outputDir, llmConfig) {
  const dbPath = path.join(repoPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) return;

  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`
    SELECT name, kind, file_path, signature, docstring,
      (SELECT COUNT(*) FROM edges e JOIN nodes n2 ON e.target = n2.id WHERE n2.name = nodes.name AND n2.file_path = nodes.file_path) AS refs
    FROM nodes WHERE kind IN ('interface', 'class') AND is_exported = 1
    ORDER BY refs DESC LIMIT 40
  `).all();
  db.close();
  if (rows.length === 0) return;

  // Group by top-level directory
  const groups = {};
  for (const r of rows) {
    const dir = r.file_path.split('/')[0];
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(r);
  }

  let md = '# 📐 数据结构设计\n\n核心 interface 和 class 定义。\n\n';

  for (const [dir, items] of Object.entries(groups)) {
    md += `## ${dir}\n\n`;

    // Use LLM to describe each struct if available, otherwise fallback to table
    if (llmConfig && llmConfig.apiKey) {
      const itemList = items.map(i =>
        `### ${i.name}\n- **kind:** ${i.kind}\n- **file:** ${i.file_path}\n- **signature:** ${i.signature || '-'}\n- **docstring:** ${(i.docstring || '-').slice(0, 200)}\n- **references:** ${i.refs}\n`
      ).join('\n');

      const prompt = `Describe each data structure below with a fixed format.

Fixed format for EACH structure:
### {name}
**用途:** (1-2 sentences on what this struct/interface represents and where it's used)

| 字段 | 类型 | 说明 |
| (LLM fills this table based on the signature and context) |

Structures to describe:
${itemList}

References count indicates how many other code symbols reference this type — higher means more central.
Only output the formatted descriptions. 请用中文输出，所有说明文字使用中文。`;

      const result = await callLLM(prompt, llmConfig, 4096);
      if (result) {
        md += result + '\n\n';
        continue;
      }
    }

    // Fallback: table format
    md += '| 名称 | 类型 | 文件 | 引用次数 |\n|------|------|------|----------|\n';
    for (const item of items) {
      md += `| \`${item.name}\` | ${item.kind} | \`${item.file_path}\` | ${item.refs} |\n`;
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

    // Step 1: Generate overview (identifies architecture modules via LLM)
    const overviewModules = await generateOverview(resolvedPath, outputDir, llmConfig);

    // Step 2: Build module_tree.json from architecture modules + codegraph data
    const modTree = await buildModuleTree(resolvedPath, outputDir, overviewModules);

    // Step 3: Generate data model page
    await generateDataModelPage(resolvedPath, outputDir, llmConfig);

    // Step 4: Generate module pages using architecture-based tree
    if (withModules && modTree && modTree.length > 0 && llmConfig.apiKey) {
      console.log(`\n[${step}/${totalSteps}] Generating module pages (${modTree.length} modules)...`);
      // Load codegraph data for module page generation
      let cgExports = {};
      let cgEdges = [];
      const cgDbPath = path.join(resolvedPath, '.codegraph', 'codegraph.db');
      if (fs.existsSync(cgDbPath)) {
        try {
          const cgDb = new DatabaseSync(cgDbPath);
          const exps = cgDb.prepare("SELECT file_path, name, kind FROM nodes WHERE is_exported = 1").all();
          for (const e of exps) {
            if (!cgExports[e.file_path]) cgExports[e.file_path] = [];
            cgExports[e.file_path].push({ name: e.name, kind: e.kind });
          }
          cgEdges = cgDb.prepare(`
            SELECT n1.file_path AS caller, n2.file_path AS callee, COUNT(*) AS count
            FROM edges e JOIN nodes n1 ON e.source = n1.id JOIN nodes n2 ON e.target = n2.id
            WHERE e.kind IN ('calls','imports','references') AND n1.file_path != n2.file_path
            GROUP BY n1.file_path, n2.file_path ORDER BY count DESC
          `).all();
          cgDb.close();
        } catch {}
      }
      await generateModulePages({ tree: modTree, moduleMap: {}, exportsByFile: cgExports, edges: cgEdges }, resolvedPath, outputDir, llmConfig);
    }
    if (withModules && !llmConfig.apiKey) {
      console.log('  ⚠ --modules requires LLM API key. Set OPENAI_API_KEY or configure ~/.opencodewiki/config.json');
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
