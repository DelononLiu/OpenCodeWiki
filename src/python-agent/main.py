"""
FastAPI 入口：LangGraph Agent 服务。

启动：uvicorn main:app --port 8000 --reload
依赖：TS codegraph-bridge 运行在端口 4747
"""

import json
import uuid
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from agent import build_agent

app = FastAPI(title="OpenCodeWiki Agent", version="0.1.0")

# 全局 Agent 实例（惰性初始化）
_agent = None


def get_agent():
    global _agent
    if _agent is None:
        _agent = build_agent()
    return _agent


async def event_stream(question: str, session_id: str, repo: str = "") -> AsyncGenerator[str, None]:
    """LangGraph Agent SSE 流式输出"""
    agent = get_agent()

    # 1. session 事件
    yield _sse("session", {"id": session_id})

    # 2. 构建消息：包含仓库上下文
    repo_hint = f"\n\n(当前项目: {repo})" if repo else ""
    messages = [("user", question + repo_hint)]

    # 2. 运行 Agent
    config = {
        "configurable": {"thread_id": session_id},
        # 限制最大工具调用步数，防止无限循环
        "recursion_limit": 100,
    }

    error_message = None
    final_answer = ""

    try:
        async for chunk in agent.astream(
            {"messages": messages},
            config=config,
        ):
            if "__end__" in chunk:
                break
            for node, values in chunk.items():
                if isinstance(values, dict):
                    if "messages" in values:
                        msgs = values["messages"]
                        if msgs:
                            for m in (msgs if isinstance(msgs, list) else [msgs]):
                                role = getattr(m, "type", "") or getattr(m, "role", "")
                                if role not in ("ai", "assistant"):
                                    continue
                                if hasattr(m, "content") and m.content and isinstance(m.content, str):
                                    text = m.content
                                    if text not in final_answer:
                                        new_text = text[len(final_answer):] if text.startswith(final_answer) else text
                                        if new_text:
                                            final_answer = text
                                            yield _sse("token", {"content": new_text})
                    if "next" in values:
                        yield _sse("reasoning", {"content": "🔍 正在搜索..."})

    except Exception as e:
        error_message = str(e)
        yield _sse("error", {"message": f"Agent 执行出错: {error_message}"})

    # 3. 完成事件
    if not error_message:
        yield _sse("done", {})


def _sse(event_type: str, data: dict) -> str:
    """构造 SSE 消息"""
    return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"


# ── API ─────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok"}


@app.post("/agent/qa")
async def agent_qa(request: Request):
    """
    LangGraph Agent 问答接口（SSE 流式）。

    请求体：{ "question": "...", "sessionId": "..." }
    响应：SSE 流，与 /api/qa 格式兼容。
    """
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
    """辅助：单条 SSE 消息生成器"""
    yield msg
