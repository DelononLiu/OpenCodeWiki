/**
 * reranker.mjs — 交叉编码器重排序服务
 *
 * Python 子进程调用 Ettin-reranker-32m-v1 ONNX 模型。
 * stdin/stdout 传 JSON 与 Node.js 通信。
 *
 * Python 依赖: onnxruntime + transformers（已安装）
 */

import { spawn } from 'child_process';

let pyProcess = null;
let pending = [];
let nextId = 0;

const PY_SCRIPT = `
import sys, json, numpy as np
import onnxruntime
from transformers import AutoTokenizer

model_dir = '/home/long2015/Code/ettin-reranker-32m-v1'
session = onnxruntime.InferenceSession(model_dir + '/onnx/model_quint8_avx2.onnx')
tokenizer = AutoTokenizer.from_pretrained(model_dir)

for line in sys.stdin:
    try:
        req = json.loads(line)
        pairs = [(req['query'], c) for c in req['candidates']]
        inputs = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors='np')
        results = session.run(None, {
            'input_ids': inputs['input_ids'].astype(np.int64),
            'attention_mask': inputs['attention_mask'].astype(np.int64),
        })
        hidden = results[0]  # (batch, seq_len, 384)
        # [CLS] token pooling + sum
        scores = hidden[:, 0, :].sum(axis=1).tolist()
        # sigmoid
        scores = [1 / (1 + np.exp(-s)) for s in scores]
        resp = {'id': req['id'], 'scores': scores}
        sys.stdout.write(json.dumps(resp) + '\\n')
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({'id': req.get('id',''), 'error': str(e)}) + '\\n')
        sys.stdout.flush()
`;

function startPython() {
  if (pyProcess) return;
  pyProcess = spawn('python3', ['-c', PY_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = [];
  pyProcess.stdout.on('data', (data) => {
    lines.push(data.toString());
    const full = lines.join('');
    const parts = full.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i].trim()) continue;
      try {
        const resp = JSON.parse(parts[i]);
        const p = pending.find(p => p.id === resp.id);
        if (p) {
          if (resp.error) p.reject(new Error(resp.error));
          else p.resolve(resp.scores);
          pending.splice(pending.indexOf(p), 1);
        }
      } catch {}
    }
    lines.length = 1;
    lines[0] = parts[parts.length - 1];
  });

  pyProcess.stderr.on('data', (data) => {
    // Python stderr 输出（可忽略）
  });

  pyProcess.on('exit', (code) => {
    pyProcess = null;
    for (const p of pending) p.reject(new Error(`Python process exited: ${code}`));
    pending = [];
  });
}

/**
 * 对 (query, candidates) 批量打分
 * @param {string} query
 * @param {string[]} candidates
 * @returns {Promise<number[]>} scores
 */
export async function scoreBatch(query, candidates) {
  return new Promise((resolve, reject) => {
    startPython();
    const id = String(++nextId);
    pending.push({ id, resolve, reject });
    pyProcess.stdin.write(JSON.stringify({ id, query, candidates }) + '\n');
  });
}

/**
 * 对单个 (query, candidate) 打分
 */
export async function score(query, candidate) {
  const scores = await scoreBatch(query, [candidate]);
  return scores[0];
}

/**
 * 批量重排序
 */
export async function rerank(query, candidates) {
  const texts = candidates.map(c => c.text || c);
  const scores = await scoreBatch(query, texts);
  return candidates.map((c, i) => ({ ...c, relevanceScore: scores[i] }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ── CLI 测试 ──
if (process.argv[1]?.endsWith('reranker.mjs')) {
  const q = process.argv[2] || 'search function';
  const docs = process.argv.slice(3) || ['searchNodes query', 'unrelated code'];
  rerank(q, docs.map(d => ({ text: d }))).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
