"""
StateGraph: 按意图路由的自定义 Agent 流程。

  分类 → 按意图路由 → 子图执行 → 合成回答
"""

import asyncio
from typing import AsyncGenerator, Literal

from langgraph.graph import END, StateGraph
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphRecursionError
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from typing import TypedDict, Sequence

from agent import SYSTEM_PROMPT
from agent import _build_llm as build_llm
from config import get_llm_config
from tools import CODEGRAPH_TOOLS


# ── 状态 ─────────────────────────────────────────────────────

class GraphState(TypedDict):
    question: str
    project: str
    intent: str
    messages: Sequence

# ── 意图配置 ────────────────────────────────────────────────

INTENTS = {
    "where-is":  "定位代码",
    "what-is":   "解释功能",
    "how-to":    "用法说明",
    "why-error": "排错分析",
    "what-impact": "影响分析",
    "build":     "编译配置",
    "general":   "通用",
}

INTENT_GUIDE = {
    "where-is": "工具侧重：code_search。搜到符号后直接回答，不需要深入追踪。",
    "what-is": "工具侧重：code_search → code_context。先搜定义，再看上下文和调用者。",
    "how-to": "工具侧重：code_search → code_callers/callees。追踪调用链展示用法。",
    "why-error": "工具侧重：code_grep → code_search → code_callers。先搜错误码再定位代码。",
    "what-impact": "工具侧重：code_search → code_callers → code_callees。追踪双向调用链。",
    "build": "工具侧重：code_grep → code_search。编译选项、CMakeLists.txt、宏定义优先用 code_grep 文本搜索，不要用 search_graph 搜这些。",
    "general": "综合搜索。先 grep 确认方向，再用 search 定位。",
}

INTENT_LIMITS = {
    "where-is": 10, "what-is": 20, "how-to": 25,
    "why-error": 30, "what-impact": 30, "build": 30, "general": 20,
}


def _prompt_for(intent: str) -> str:
    guide = INTENT_GUIDE.get(intent, INTENT_GUIDE["general"])
    return f"{SYSTEM_PROMPT}\n\n## 当前意图\n{INTENTS.get(intent, '通用')}\n\n{guide}"


# ── 懒加载子 agent ─────────────────────────────────────────

_agents = {}

def _get_agent(intent: str):
    if intent not in _agents:
        llm = build_llm(get_llm_config())
        _agents[intent] = create_react_agent(
            model=llm,
            tools=CODEGRAPH_TOOLS,
            prompt=_prompt_for(intent),
            checkpointer=MemorySaver(),
            name=f"agent-{intent}",
        )
    return _agents[intent]


# ── 节点函数 ────────────────────────────────────────────────

def classify_intent(state: GraphState) -> dict:
    """LLM 一次调用判断意图"""
    question = state["question"]
    desc = "\n".join(f"- {k}: {v}" for k, v in INTENTS.items())
    llm = build_llm(get_llm_config())
    resp = llm.invoke(
        f"用户问题：{question}\n\n问题类型：\n{desc}\n\n只输出类型名称。"
    )
    intent = resp.content.strip().lower()
    if intent not in INTENTS:
        intent = "general"
    return {"intent": intent}


def route(state: GraphState) -> str:
    return state.get("intent", "general")


async def run_sub(state: GraphState) -> dict:
    """运行按意图配置的子 agent"""
    intent = state.get("intent", "general")
    agent = _get_agent(intent)
    repo_hint = f"\n\n(当前项目: {state.get('project', '')})" if state.get("project") else ""
    msgs = [HumanMessage(content=state["question"] + repo_hint)]

    limit = INTENT_LIMITS.get(intent, 20)

    config = {"recursion_limit": limit, "configurable": {"thread_id": "sub"}}

    try:
        final = await agent.ainvoke({"messages": msgs}, config)
        all_msgs = final.get("messages", [])
    except GraphRecursionError:
        # 触底时直接用 LLM 回答，不做状态恢复
        llm = build_llm(get_llm_config())
        resp = llm.invoke(
            f"用户问题：{state['question']}\n\n"
            f"在代码库中搜索了{limit}步未找到完整信息，请基于已有知识直接回答。"
        )
        all_msgs = [AIMessage(content=resp.content)]

    return {"messages": all_msgs}


# ── 构建图 ──────────────────────────────────────────────────

def build_graph():
    graph = StateGraph(GraphState)

    graph.add_node("classify", classify_intent)
    for k in INTENTS:
        graph.add_node(f"run_{k}", run_sub)

    graph.add_conditional_edges("classify", route, {k: f"run_{k}" for k in INTENTS})
    for k in INTENTS:
        graph.add_edge(f"run_{k}", END)

    graph.set_entry_point("classify")
    return graph.compile(checkpointer=MemorySaver())


# 全局图实例，供 main.py 使用
_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
