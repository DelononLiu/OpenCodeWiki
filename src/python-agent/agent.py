"""
Agent: LangGraph 问答 Agent 定义。

当前使用 create_react_agent（ReAct 模式）：
  LLM 思考 → 调工具 → 看结果 → 再思考 → ... → 回答

后续可根据需要升级为自定义 StateGraph（多步推理、条件分支、中断审批等）。
"""

from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

from config import get_llm_config
from tools import CODEGRAPH_TOOLS

# ── System prompt ────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个代码分析助手（opencode-wiki agent），基于 codebase-memory-mcp 引擎回答代码相关问题。

## 工作方式

你有 9 个代码分析工具可用。根据问题自主决定搜索策略：
1. 先用 code_search 搜索问题中的关键符号/概念
2. 用 code_context 获取符号的完整定义
3. 用 code_callers/callees/impact 分析调用关系
4. 多个搜索结果后，综合分析并回答

## 规则
- 用中文回答
- 适当使用代码块展示源码片段
- 引用文件时包含文件名和行号
- 不要编造不存在的信息
- 如果搜不到相关代码，如实说"未搜到"
"""


def _build_llm(cfg: dict):
    """根据配置构建 LLM 实例"""
    provider = cfg.get("provider", "openai")
    model = cfg.get("model", "gpt-4o-mini")
    api_key = cfg.get("apiKey", "")
    base_url = cfg.get("baseUrl", "https://api.openai.com/v1")

    if not api_key:
        raise ValueError(
            "LLM API key not configured. "
            "Set OPENAI_API_KEY env var or configure ~/.opencodewiki/config.json"
        )

    if provider == "anthropic":
        return ChatAnthropic(
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=0,
        )
    # 默认 OpenAI 兼容（也支持 Azure / Ollama / vLLM 等）
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
    )


def build_agent():
    """构建 LangGraph ReAct Agent"""
    cfg = get_llm_config()
    llm = _build_llm(cfg)

    # MemorySaver 支持对话历史 + 中断恢复
    checkpointer = MemorySaver()

    agent = create_react_agent(
        model=llm,
        tools=CODEGRAPH_TOOLS,
        prompt=SYSTEM_PROMPT,
        checkpointer=checkpointer,
        name="opencode-wiki-agent",
    )

    return agent
