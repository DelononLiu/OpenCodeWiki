"""
FastAPI 入口：StateGraph Agent 服务。

启动：uvicorn main:app --port 8000 --reload
"""

import json
import uuid
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from graph import build_graph

app = FastAPI(title="OpenCodeWiki Agent", version="0.1.0")

_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph


async def event_stream(question: str, session_id: str, repo: str = "") -> AsyncGenerator[str, None]:
    """StateGraph SSE 流式输出"""
    graph = get_graph()

    yield _sse("session", {"id": session_id})

    final_answer = ""
    try:
        result = await graph.ainvoke(
            {"question": question, "project": repo, "intent": "", "messages": []},
            config={"configurable": {"thread_id": session_id}},
        )
        for m in result.get("messages", []):
            role = getattr(m, "type", "") or getattr(m, "role", "")
            if role in ("ai", "assistant") and hasattr(m, "content") and m.content:
                final_answer += m.content

        if final_answer:
            yield _sse("token", {"content": final_answer})
        else:
            yield _sse("reasoning", {"content": "未能生成回答"})

    except Exception as e:
        yield _sse("error", {"message": f"Agent 执行出错: {e}"})

    finally:
        yield _sse("done", {})


def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/agent/qa")
async def agent_qa(request: Request):
    body = await request.json()
    question = (body.get("question") or "").strip()
    session_id = body.get("sessionId") or str(uuid.uuid4())
    repo = body.get("repo") or body.get("project") or ""

    if not question:
        return StreamingResponse(
            _sse_generator(f"data: {json.dumps({'type': 'error', 'message': 'Missing question'})}\n\n"),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        event_stream(question, session_id, repo),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse_generator(msg: str) -> AsyncGenerator[str, None]:
    yield msg
