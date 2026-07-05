/**
 * LangGraph Agent 问答处理器。
 *
 * 将请求转发到 Python FastAPI 服务（port 8000），SSE 流透传到前端。
 * 完全独立，不依赖 qa-endpoint.ts 的 session 管理或 ACP 逻辑。
 */

import type { Request, Response } from 'express';

const PY_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export async function langgraphHandler(req: Request, res: Response): Promise<void> {
  const body = typeof req.body === 'object' ? req.body : {};
  const question = (body.question || '').trim();

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
    let aborted = false;
    req.on('close', () => { aborted = true; reader.cancel().catch(() => {}); });

    while (true) {
      if (aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  }
}
