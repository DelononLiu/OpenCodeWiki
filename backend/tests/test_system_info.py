"""SystemInfoPlugin：系统元数据问答（有哪些知识库/文档）。"""
import pytest
from backend.pipeline.plugins.system_info import SystemInfoPlugin, is_system_query, build_system_summary
from backend.pipeline.events import PipelineEvent
from backend.stores.users import create_user
from backend.stores.kb import create_kb
from backend.stores.doc import create_document


# ── 规则检测 ──

def test_is_system_query_positive():
    for q in [
        "你有哪些知识库?",
        "有几个知识库",
        "知识库列表是什么",
        "系统里有哪些文档",
        "当前有多少文档",
        "所有知识库有哪些",
    ]:
        assert is_system_query(q), f"应命中系统问题: {q}"


def test_is_system_query_negative():
    for q in [
        "Flux 单向数据流是什么？",
        "如何部署 OpenCodeWiki？",
        "你好",
        "Kubernetes 怎么安装",
    ]:
        assert not is_system_query(q), f"不应命中系统问题: {q}"


# ── 系统摘要构建 ──

def test_build_system_summary_lists_kbs():
    owner = create_user("alice", "pw")["id"]
    kb1 = create_kb("产品文档库", "docs")
    kb2 = create_kb("代码库", "code")
    doc = create_document(kb1["id"], "readme.md", "/tmp/readme.md", "hash1", "md")
    summary = build_system_summary()
    assert "2 个知识库" in summary
    assert "产品文档库" in summary
    assert "代码库" in summary


# ── 插件行为 ──

def test_plugin_sets_system_intent_on_hit():
    import asyncio
    plugin = SystemInfoPlugin()
    event = PipelineEvent(question="你有哪些知识库?", kb_ids=["kb-x"], intent="kb_search")
    event = asyncio.run(plugin.process(event))
    assert event.intent == "system"
    assert "知识库" in event.system_context


def test_plugin_passthrough_on_miss():
    import asyncio
    plugin = SystemInfoPlugin()
    event = PipelineEvent(question="Flux 是什么？", kb_ids=["kb-x"], intent="kb_search")
    event = asyncio.run(plugin.process(event))
    assert event.intent == "kb_search"
    assert event.system_context == ""


# ── ContextBuild 的 system 分支 ──

def test_context_build_uses_system_context():
    import asyncio
    from backend.pipeline.plugins.context_build import ContextBuildPlugin
    plugin = ContextBuildPlugin(
        system_prompt_template="tpl {{contexts}} {{language}}",
        context_template="ctx {{contexts}} {{query}}",
    )
    event = PipelineEvent(
        question="有哪些知识库?",
        kb_ids=["kb-x"],
        intent="system",
        system_context="【系统信息】当前系统共有 2 个知识库：\n- 产品文档库",
    )
    event = asyncio.run(plugin.process(event))
    assert "当前系统共有 2 个知识库" in event.context_text
    assert "问题" in event.context_text or "Question" in event.context_text
    assert event.system_prompt  # 使用专门的 system prompt
