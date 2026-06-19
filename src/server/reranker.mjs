/**
 * reranker.mjs — 交叉编码器重排序服务
 *
 * Python 子进程调用 Ettin-reranker-32m-v1（sentence-transformers）。
 * stdin/stdout 传 JSON 与 Node.js 通信，进程常驻不反复重启。
 *
 * Python 依赖: sentence-transformers + torch（已安装）
 */

import { spawn } from 'child_process';

let pyProcess = null;
let pending = [];
let nextId = 0;

const MODEL_DIR = '/home/long2015/Code/ettin-reranker-32m-v1';

const PY_SCRIPT = `
import sys, json
from sentence_transformers import CrossEncoder

model = CrossEncoder('${MODEL_DIR}')
sys.stderr.write('[reranker-py] 模型加载完成\\n')
sys.stderr.flush()

for line in sys.stdin:
    try:
        req = json.loads(line)
        pairs = [(req['query'], c) for c in req['candidates']]
        scores = model.predict(pairs, show_progress_bar=False).tolist()
        resp = {'id': req['id'], 'scores': scores}
        sys.stdout.write(json.dumps(resp) + '\\n')
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({'id': req.get('id',''), 'error': str(e)}) + '\\n')
        sys.stdout.flush()
`;

function startPython() {
  if (pyProcess) return;
  pyProcess = spawn('python3', ['-c', PY_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });

  let buffer = '';
  pyProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const resp = JSON.parse(line);
        const p = pending.find(p => p.id === resp.id);
        if (p) {
          pending = pending.filter(x => x.id !== resp.id);
          resp.error ? p.reject(new Error(resp.error)) : p.resolve(resp.scores);
        }
      } catch {}
    }
  });

  pyProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('[reranker]', msg);
  });

  pyProcess.on('exit', (code) => {
    pyProcess = null;
    for (const p of pending) p.reject(new Error(`Python 进程退出: ${code}`));
    pending = [];
  });
}

export async function scoreBatch(query, candidates) {
  return new Promise((resolve, reject) => {
    startPython();
    const id = String(++nextId);
    pending.push({ id, resolve, reject });
    pyProcess.stdin.write(JSON.stringify({ id, query, candidates }) + '\n');
  });
}

export async function score(query, candidate) {
  const s = await scoreBatch(query, [candidate]);
  return s[0];
}

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
    for (const item of r) console.log(`${item.relevanceScore.toFixed(2)}\t${item.text}`);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
