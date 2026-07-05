/**
 * LangGraph Agent 问答处理器。
 *
 * 将请求转发到 Python FastAPI 服务（port 8000），SSE 流透传到前端。
 * 流结束后解析回答中的文件引用，推送 sources 事件。
 */

import type { Request, Response } from 'express';
import { resolveAnswerSources } from '../qa/sources.js';

const PY_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export async function langgraphHandler(req: Request, res: Response): Promise<void> {
  const body = typeof req.body === 'object' ? req.body : {};
  const question = (body.question || '').trim();
  const repo = (body.repo || '') as string;

  if (!question) {
    res.status(400).json({ error: 'Missing "question" in request body' });
    return;
  }

  try {
    const pyResp = await fetch(`${PY_AGENT_URL}/agent/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!pyResp.ok) {
      const errText = await pyResp.text().catch(() => 'unknown error');
      res.status(502).json({ error: `Agent backend error: ${errText.slice(0, 500)}` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = pyResp.body!.getReader();
    const decoder = new TextDecoder();
    let aborted = false;
    req.on('close', () => { aborted = true; reader.cancel().catch(() => {}); });

    let answerText = '';

    while (true) {
      if (aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Filter out Python's own "done" — we send it after sources
      const lines = chunk.split('\n').filter(l => {
        if (l.startsWith('data: ')) {
          try {
            const d = JSON.parse(l.slice(6));
            if (d.type === 'done') return false; // skip, we'll send our own
          } catch {}
        }
        return true;
      });
      if (lines.length > 0) {
        res.write(lines.join('\n'));
      }
      // Collect answer text for source resolution
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'token' && d.content) {
              answerText += d.content;
            }
          } catch {}
        }
      }
    }

    // Resolve file references in the answer
    if (answerText.length > 20) {
      try {
        const repoBase = repo ? null : null; // resolveAnswerSources handles null
        const sources = await resolveAnswerSources(answerText, [], repoBase);
        if (sources.length > 0) {
          res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
        }
      } catch (e) {
        // Non-fatal: sources are best-effort
      }
    }

    res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
    res.end();
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  }
}
