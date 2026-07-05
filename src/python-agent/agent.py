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

### 搜索方法
1. **确认目标项目**：用户消息末尾可能带有 `(当前项目: xxx)` 标记
   - 如果有，优先搜这个项目，所有工具都传 `project` 参数
   - 如果没有或搜不到结果，用 code_list_repos 列出所有仓库再搜
2. **scope 搜索**：code_search / code_context / code_callers 等工具
   都支持 `project` 参数，传仓库名可限定搜索范围
   - 知道仓库名时一定要传 project
   - 不确定仓库名时先不传，搜到结果看归属
3. 如果第一次搜索无结果或结果不相关，换一组搜索词重试
   - 尝试更短的搜索词
   - 尝试英文关键词
   - 尝试不同的术语
4. 用 code_context 获取符号的完整定义
5. 用 code_callers/callees/impact 分析调用关系
6. 多个搜索结果后，综合分析并回答

### 搜索深度
- 简单定位问题（where-is）：搜 1-2 次即可
- 功能解释问题（what-is）：搜 2-3 次，获取定义+上下文
- 排错/影响分析（why-error/what-impact）：搜 3-5 次，追踪调用链
- **及时收手**：搜了 5 次还没找到关键信息，就基于已有结果组织回答，不要继续搜
- **别空答**：不要用"让我搜索"、"让我看看"这类话填充，直接基于已有信息作答

## 规则
- 用中文回答
- 适当使用代码块展示源码片段
- 引用文件时包含文件名和行号
- 不要编造不存在的信息
- 如果搜不到相关代码，如实说"未搜到"，不要自己编造
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
