/**
 * vector-store.mjs — 向量存储服务
 *
 * 存储: Node 内置 node:sqlite，向量存为 JSON 数组
 * 搜索: 暴力余弦相似度（内存加载，50k × 384d ~ 5ms）
 *
 * 嵌入策略（可切换）:
 *   dev   → 确定性哈希向量（无依赖，测管道用）
 *   local → @xenova/transformers 加载本地 ONNX 模型
 *   prod  → C2LLM-0.5B API（生产用）
 *
 * ── ONNX 模型下载地址 ────────────────────────────────────────────
 * all-MiniLM-L6-v2（嵌入，384 维）:
 *   https://www.modelscope.cn/models/sentence-transformers/all-MiniLM-L6-v2/resolve/master/onnx/model_quint8_avx2.onnx
 * ettin-reranker-32m-v1（重排序）:
 *   https://www.modelscope.cn/models/cross-encoder/ettin-reranker-32m-v1/resolve/master/onnx/model_quint8_avx2.onnx
 * ─────────────────────────────────────────────────────────────────
 *
 * 安装方式:
 *   1. 下载 model_quint8_avx2.onnx
 *   2. 放到 node_modules/@xenova/transformers/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
 *   3. 同时复制 config.json、tokenizer.json 等配套文件
 *
 * 与 codebase-memory-mcp 关系:
 *   - 从 ~/.cache/codebase-memory-mcp/<project>.db 读取符号
 *   - 通过 node.id 关联符号
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const VECTOR_DIR = path.join(os.homedir(), '.opencodewiki', 'vectors');
const EMBED_DIM = 384;

// ── 嵌入引擎（可切换）───────────────────────────────────────────────

/**
 * 开发阶段：确定性哈希向量。
 * 相同文本始终生成相同向量，可测整条管道，零依赖。
 */
function hashVector(text) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vec = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) {
    // 用 hash 的不同字节段生成 [-1, 1] 之间的值
    const byte = hash[i % 32] ^ hash[(i * 7) % 32];
    vec[i] = (byte / 127.5) - 1;
  }
  // 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / (norm || 1));
}

/**
 * 生产阶段：通过 API 嵌入。
 * 需配置 C2LLM-0.5B API 端点。
 */
async function apiEmbed(text) {
  const apiUrl = process.env.EMBED_API_URL || 'http://localhost:8080/embed';
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`embed API error: ${res.status}`);
  const data = await res.json();
  return data.vector || data.embedding;
}

/**
 * 本地模型：@xenova/transformers。
 * 需先下载 ONNX 模型到本地缓存（首次运行自动下载）。
 */
let transformersModel = null;

async function localModelEmbed(text) {
  if (!transformersModel) {
    const { pipeline } = await import('@xenova/transformers');
    transformersModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  const result = await transformersModel(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

/**
 * 嵌入入口：根据环境变量选择引擎。
 * EMBED_ENGINE=hash | api | local | ollama
 * 不设时自动检测：本地模型文件存在 → local，否则 → hash
 */
function detectEngine() {
  if (process.env.EMBED_ENGINE) return process.env.EMBED_ENGINE;
  const modelPath = path.join(os.homedir(), '.cache', 'huggingface', 'hub',
    'models--Xenova--all-MiniLM-L6-v2', 'snapshots');
  try { const entries = fs.readdirSync(modelPath); if (entries.length > 0) return 'local'; } catch {}
  // 也检查 transformers.js 内置路径
  const altPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..',
    'node_modules', '@xenova', 'transformers', 'models', 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx');
  try { if (fs.existsSync(altPath)) return 'local'; } catch {}
  return 'hash';
}

export async function embedText(text) {
  const engine = detectEngine();
  switch (engine) {
    case 'api':    return await apiEmbed(text);
    case 'local':  return await localModelEmbed(text);
    case 'ollama': return await ollamaEmbed(text);
    default:       return hashVector(text);
  }
}

/**
 * Ollama 嵌入：调用本地 Ollama API。
 * 需先安装 Ollama: curl -fsSL https://ollama.com/install.sh | sh
 * 拉取模型: ollama pull nomic-embed-text
 */
async function ollamaEmbed(text) {
  const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

export function getEmbedDimension() {
  return EMBED_DIM;
}

// ── 向量库（node:sqlite）─────────────────────────────────────────────

function vecDbPath(repoName) {
  const safe = repoName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(VECTOR_DIR, `${safe}.vec.db`);
}

function openVecDb(repoName) {
  const dbPath = vecDbPath(repoName);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}

export function ensureTable(repoName) {
  const db = openVecDb(repoName);
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      node_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db.close();
}

export function upsertVector(repoName, nodeId, vector) {
  const db = openVecDb(repoName);
  db.prepare('INSERT OR REPLACE INTO vectors(node_id, embedding) VALUES (?, ?)').run(nodeId, JSON.stringify(vector));
  db.close();
}

export function upsertVectors(repoName, entries) {
  const db = openVecDb(repoName);
  const stmt = db.prepare('INSERT OR REPLACE INTO vectors(node_id, embedding) VALUES (?, ?)');
  for (const { nodeId, vector } of entries) {
    stmt.run(nodeId, JSON.stringify(vector));
  }
  db.close();
}

export function setMeta(repoName, key, value) {
  const db = openVecDb(repoName);
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value);
  db.close();
}

export function getMeta(repoName, key) {
  const db = openVecDb(repoName);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  db.close();
  return row ? row.value : null;
}

// ── 余弦相似度 ──────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── 搜索（暴力，全量加载）────────────────────────────────────────────

/**
 * 从向量库加载所有向量到内存
 */
function loadAllVectors(repoName) {
  const db = openVecDb(repoName);
  const rows = db.prepare('SELECT node_id, embedding FROM vectors').all();
  db.close();
  return rows.map(r => ({
    nodeId: r.node_id,
    vector: JSON.parse(r.embedding),
  }));
}

/**
 * 向量搜索
 */
export function vectorSearch(repoName, queryVector, topK = 20) {
  const all = loadAllVectors(repoName);
  const scored = all.map(item => ({
    nodeId: item.nodeId,
    score: cosineSimilarity(queryVector, item.vector),
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ── RRF 融合 ────────────────────────────────────────────────────────

/**
 * RRF 融合：合并 FTS5 和向量搜索结果
 * @param {Array} ftsResults    [{nodeId, name, filePath, score}]
 * @param {Array} vecResults    [{nodeId, score}]
 * @param {number} k RRF 常数（默认 60）
 */
export function rrfMerge(ftsResults, vecResults, k = 60) {
  const scores = new Map();

  for (let i = 0; i < ftsResults.length; i++) {
    const id = ftsResults[i].nodeId;
    const current = scores.get(id) || 0;
    scores.set(id, current + 1 / (k + i + 1));
  }

  for (let i = 0; i < vecResults.length; i++) {
    const id = vecResults[i].nodeId;
    const current = scores.get(id) || 0;
    scores.set(id, current + 1 / (k + i + 1));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nodeId, rrfScore]) => ({ nodeId, rrfScore }));
}

// ── 批量嵌入 ─────────────────────────────────────────────────────────

export async function embedRepo(repoName, repoPath) {
  ensureTable(repoName);

  // codebase-memory-mcp DB 路径
  const projectName = repoPath.replace(/^\//, '').replace(/\//g, '-');
  const cbmDb = path.join(os.homedir(), '.cache', 'codebase-memory-mcp', projectName + '.db');
  if (!fs.existsSync(cbmDb)) {
    console.error(`[vector-store] codebase-memory-mcp DB 不存在: ${cbmDb}`);
    return 0;
  }

  const srcDb = new DatabaseSync(cbmDb);
  const rows = srcDb.prepare(`
    SELECT id, name, qualified_name, file_path
    FROM nodes
    WHERE label IN ('function', 'method', 'class', 'interface', 'struct', 'enum', 'type_alias', 'module', 'constant', 'variable')
    ORDER BY label
  `).all();
  srcDb.close();

  console.log(`[vector-store] 嵌入 ${rows.length} 个符号...`);
  const batchSize = 20;
  let count = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const entries = [];
    for (const row of batch) {
      const text = [row.name, row.qualified_name, row.file_path || '']
        .filter(Boolean).join('\n');
      if (!text.trim()) continue;
      const vector = await embedText(text);
      entries.push({ nodeId: row.id, vector });
    }
    if (entries.length > 0) upsertVectors(repoName, entries);
    count += entries.length;
    process.stdout.write(`\r  → ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }

  setMeta(repoName, 'engine', process.env.EMBED_ENGINE || 'hash');
  setMeta(repoName, 'dimension', String(EMBED_DIM));
  setMeta(repoName, 'node_count', String(count));
  setMeta(repoName, 'indexed_at', new Date().toISOString());

  console.log(`\n[vector-store] 完成: ${count}/${rows.length} 符号已嵌入`);
  return count;
}

// ── CLI ─────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('vector-store.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'embed') {
    const repoPath = process.argv[3];
    const repoName = process.argv[4] || path.basename(repoPath);
    embedRepo(repoName, repoPath).catch(e => { console.error(e); process.exit(1); });
  } else if (cmd === 'search') {
    const repoName = process.argv[3];
    const query = process.argv[4];
    const vec = await embedText(query);
    const results = vectorSearch(repoName, vec, 10);
    console.log(JSON.stringify(results, null, 2));
  } else if (cmd === 'ensure') {
    ensureTable(process.argv[3]);
    console.log(`表就绪`);
  } else {
    console.log(`
用法:
  node src/server/vector-store.mjs embed <repo-path> [repo-name]
  node src/server/vector-store.mjs search <repo-name> <query>
  node src/server/vector-store.mjs ensure <repo-name>
    `);
  }
}
