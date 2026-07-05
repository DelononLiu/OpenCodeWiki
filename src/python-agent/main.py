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
        "recursion_limit": 25,
    }

    error_message = None
    final_answer = ""

    try:
        async for event in agent.astream_events(
            {"messages": messages},
            config=config,
            version="v2",
        ):
            kind = event["event"]

            # LLM 流式输出 token
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if hasattr(chunk, "content") and chunk.content:
                    final_answer += chunk.content
                    yield _sse("token", {"content": chunk.content})

            # 工具调用开始
            elif kind == "on_tool_start":
                tool_name = event["name"] or event.get("run_id", "")[:8]
                yield _sse("reasoning", {
                    "content": f"🔍 正在使用 `{tool_name}` 搜索..."
                })

            # 工具调用结束
            elif kind == "on_tool_end":
                output = event["data"].get("output", "")
                if output:
                    # 截取太长输出避免 SSE 爆炸
                    output_str = str(output)
                    if len(output_str) > 200:
                        output_str = output_str[:200] + "..."
                    yield _sse("reasoning", {
                        "content": f"📥 获取到结果 ({len(output_str)} chars)"
                    })

            # Agent 开始思考（介于工具调用之间）
            elif kind == "on_chain_stream":
                if event.get("name") == "agent" and not event["data"].get("output"):
                    yield _sse("reasoning", {
                        "content": "💭 分析搜索结果..."
                    })

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
