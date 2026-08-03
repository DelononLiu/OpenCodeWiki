"""SystemInfoPlugin：识别"系统元数据类问题"（有哪些知识库/文档），
把系统信息注入上下文 —— 让 LLM 能回答"系统里有什么"，而不是从文档里猜。"""

import re

from backend.pipeline.events import PipelineEvent
from backend.pipeline.pipeline import BasePlugin
from backend.stores.kb import list_kbs

# 系统类问题的规则（中文模式，宽松匹配）
_SYSTEM_PATTERNS = [
    r"哪些知识库", r"知识库列表", r"几个知识库", r"所有知识库", r"知识库有",
    r"有哪些文档", r"文档列表", r"几个文档", r"多少文档",
    r"系统.*(配置|信息|设置|有哪些)",
    r"知识库.*(有哪些|是什么|多少|几个)",
]


def is_system_query(question: str) -> bool:
    """规则判断问题是否询问系统元数据（知识库/文档清单）。"""
    return any(re.search(p, question) for p in _SYSTEM_PATTERNS)


def build_system_summary() -> str:
    """生成系统知识库清单摘要。"""
    kbs = list_kbs()
    lines = [f"【系统信息】当前系统共有 {len(kbs)} 个知识库："]
    for kb in kbs:
        doc_count = kb.get("doc_count") or 0
        chunk_count = kb.get("chunk_count") or 0
        content_type = kb.get("content_type") or "docs"
        lines.append(f"- {kb['name']}：{doc_count} 篇文档 / {chunk_count} 个切片（类型 {content_type}）")
    if not kbs:
        lines.append("（暂无知识库）")
    return "\n".join(lines)


class SystemInfoPlugin(BasePlugin):
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        if is_system_query(event.question):
            event.intent = "system"
            event.system_context = build_system_summary()
        return event
