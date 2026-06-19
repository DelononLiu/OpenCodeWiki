/**
 * chunker.mjs — 类/文件/模块级代码块索引
 *
 * 在符号级索引（codegraph node）之上，补充粗粒度代码块：
 *   - 类级 chunk:  整个类 + 所有方法
 *   - 文件级 chunk: 文件 exports + 核心符号
 *   - 模块级 chunk: 目录下所有文件 + 入口文件
 *
 * 每个 chunk 独立嵌入向量，检索时符号级 + chunk 级并行搜，RRF 融合。
 */

import { DatabaseSync } from 'node:sqlite';
import { embedText, ensureTable, upsertVectors, setMeta, getMeta, vectorSearch, rrfMerge } from './vector-store.mjs';

const CHUNK_REPO = '__chunks__';

/**
 * 为一个仓库生成所有级别的 chunk 并嵌入向量
 */
export async function buildChunks(repoName, repoPath) {
  const db = new DatabaseSync(repoPath + '/.codegraph/codegraph.db');
  ensureTable(CHUNK_REPO);

  const chunks = [];

  // ── 1. 类级 chunk ──
  const classes = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.start_line, n.end_line, n.docstring, n.signature
    FROM nodes n
    WHERE n.kind = 'class'
    ORDER BY n.file_path, n.start_line
  `).all();

  for (const cls of classes) {
    const methods = db.prepare(`
      SELECT n.name, n.signature, n.docstring, n.start_line, n.end_line
      FROM edges e JOIN nodes n ON e.target = n.id
      WHERE e.source = ? AND e.kind = 'contains'
        AND n.kind IN ('method', 'property', 'field')
      ORDER BY n.start_line
    `).all(cls.id);

    const text = [
      `## Class: ${cls.name}`,
      cls.file_path ? `File: ${cls.file_path}` : '',
      cls.docstring || cls.signature || '',
      '### Methods',
      ...methods.map(m =>
        `- ${m.name}(${m.signature || ''})${m.docstring ? ': ' + m.docstring : ''}`
      ),
    ].filter(Boolean).join('\n');

    chunks.push({
      chunkId: `class:${cls.id}`,
      type: 'class',
      name: cls.name,
      filePath: cls.file_path,
      startLine: cls.start_line,
      text,
    });
  }

  // ── 2. 文件级 chunk ──
  const files = db.prepare(`
    SELECT id, name, file_path FROM nodes WHERE kind = 'file' ORDER BY file_path
  `).all();

  for (const file of files) {
    const symbols = db.prepare(`
      SELECT n.name, n.kind, n.signature, n.docstring
      FROM edges e JOIN nodes n ON e.target = n.id
      WHERE e.source = ? AND e.kind = 'contains'
        AND n.kind IN ('function', 'class', 'interface', 'type_alias', 'constant', 'variable')
      ORDER BY n.start_line LIMIT 50
    `).all(file.id);

    if (symbols.length === 0) continue;

    const text = [
      `## File: ${file.file_path}`,
      '### Exports',
      ...symbols.map(s =>
        `- ${s.kind} ${s.name}${s.signature ? ': ' + s.signature : ''}`
      ),
    ].filter(Boolean).join('\n');

    chunks.push({
      chunkId: `file:${file.id}`,
      type: 'file',
      name: file.file_path.split('/').pop(),
      filePath: file.file_path,
      text,
    });
  }

  // ── 3. 模块级 chunk（按目录分组） ──
  const dirMap = new Map();
  for (const file of files) {
    const dir = file.file_path.split('/').slice(0, -1).join('/') || '/';
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir).push(file);
  }

  for (const [dir, dirFiles] of dirMap) {
    if (dirFiles.length < 2) continue; // 单文件目录跳过
    const entryFile = dirFiles.find(f =>
      /^index\.|^main\./.test(f.file_path.split('/').pop() || '')
    );
    const symbols = db.prepare(`
      SELECT DISTINCT n.name, n.kind, n.file_path
      FROM edges e JOIN nodes n ON e.target = n.id
      WHERE e.source = ? AND e.kind = 'contains'
        AND n.kind IN ('function', 'class', 'interface')
      ORDER BY n.file_path, n.name LIMIT 30
    `).all(entryFile?.id || dirFiles[0]?.id || '');

    if (symbols.length === 0 && dirFiles.length < 3) continue;

    const text = [
      `## Module: ${dir}`,
      `Files: ${dirFiles.length}`,
      entryFile ? `Entry: ${entryFile.file_path}` : '',
      symbols.length > 0 ? '### Public API' : '',
      ...symbols.map(s => `- ${s.kind} ${s.name} (${s.file_path})`),
    ].filter(Boolean).join('\n');

    chunks.push({
      chunkId: `module:${dir}`,
      type: 'module',
      name: dir.split('/').pop() || dir,
      filePath: dir,
      text,
    });
  }

  db.close();

  // ── 4. 嵌入并存储 ──
  console.log(`[chunker] ${repoName}: ${classes.length} classes, ${files.length} files, ${dirMap.size} dirs → ${chunks.length} chunks`);
  const entries = [];
  for (let i = 0; i < chunks.length; i++) {
    const vector = await embedText(chunks[i].text);
    entries.push({ nodeId: chunks[i].chunkId, vector });
    if (i % 50 === 0) process.stdout.write(`\r  嵌入: ${i}/${chunks.length}`);
  }
  upsertVectors(CHUNK_REPO, entries);
  setMeta(CHUNK_REPO, `${repoName}_chunks`, String(chunks.length));
  setMeta(CHUNK_REPO, `${repoName}_indexed_at`, new Date().toISOString());
  console.log(`\n[chunker] ✓ ${repoName} 完成: ${chunks.length} chunks`);
  return chunks.length;
}

/**
 * 搜索 chunks
 */
export function searchChunks(queryVec, topK = 10) {
  return vectorSearch(CHUNK_REPO, queryVec, topK);
}

// ── CLI ──
if (process.argv[1]?.endsWith('chunker.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'build') {
    const repoPath = process.argv[3];
    const repoName = process.argv[4] || repoPath.split('/').pop();
    buildChunks(repoName, repoPath).then(n =>
      console.log(`完成: ${n} chunks`)
    ).catch(e => { console.error(e); process.exit(1); });
  } else {
    console.log('用法: node src/server/chunker.mjs build <repo-path> [repo-name]');
  }
}
