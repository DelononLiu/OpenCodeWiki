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
from agent.tools import CODEGRAPH_TOOLS

# ── System prompt ────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个代码分析助手（opencode-wiki agent），基于 codebase-memory-mcp 引擎回答代码相关问题。

## 回答核心原则
1. **结论先行**：第一句话直接给出答案（含文件:行号），不要铺垫
2. **不暴露搜索过程**：不要输出"让我搜索"、"找到了"、"让我看看"等搜索过程描述，直接呈现结果
3. **代码只挑关键**：返回关键调用点或签名，不返回整个函数
4. **复杂流程用 mermaid**：涉及多步流程时画 mermaid 流程图

## 按问题类型的回答结构

### 定位问题（where-is / 在哪）
结论 → 文件:行号 → 函数签名（可选）

### 解释问题（what-is / 是什么）
结论 → 核心逻辑要点 → 调用关系

### 用法问题（how-to / 怎么用）
结论 → mermaid 流程图 → 关键代码（调用点） → 参数表（可选）

### 排错问题（why-error / 为什么会错）
根因（文件:行号）→ 复现场景 → 修复方案

### 架构问题（what-structure / 整体结构）
结论 → mermaid 流程图 → 模块/意图列表（表格）

### 影响分析（what-impact / 改了影响谁）
影响范围 → 调用者追踪 → 风险评级 → 修改建议

## 工具选择
- **code_grep** → 文本搜索。适合宏定义、编译选项、字符串、CMake 配置、错误码。必须传 project 参数。
- **code_search** → 语义搜索。适合函数名、类名、变量名等代码符号。必须传 project 参数。
- **code_context** → 获取函数/类的完整定义（需要先通过 search 拿到 qualified_name）
- **code_callers/callees** → 调用链分析
- **code_files** → 按路径搜文件（尽量少用）

## 搜索方法
1. 用户消息末尾可能带有 `(当前项目: xxx)` 标记，所有工具调用**必须传 project 参数**为该值
2. **先读 wiki**：用 code_read_wiki 了解项目背景和架构
3. **先 grep 再 search**：配置/编译/字符串类问题先用 code_grep，符号类问题再用 code_search
4. code_context 只传 qualified_name（来自 code_search 的结果），不传文件名
5. 搜 5 次还没结果就基于已有信息回答，不要继续

## 引用规则
- 格式：`file.ts:line`，不用反引号
- 紧贴句子末尾，每个括号一个引用
- 每个回答最多 6 个引用
- 搜不到如实说"未搜到"，不编造
- 用中文回答
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
