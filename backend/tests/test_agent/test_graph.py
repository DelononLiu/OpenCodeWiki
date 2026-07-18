"""
test_graph.py — Agent 图编排测试

使用 mock LLM，不调真实 API。测试图结构、意图路由配置、构建逻辑。
"""

from unittest.mock import MagicMock, patch


class TestIntentConfig:
    """意图配置静态测试（不涉及 LLM 调用）"""

    def test_intents_defined(self):
        """所有意图都已定义"""
        from agent.graph import INTENTS

        assert "where-is" in INTENTS
        assert "what-is" in INTENTS
        assert "how-to" in INTENTS
        assert "why-error" in INTENTS
        assert "what-impact" in INTENTS
        assert "build" in INTENTS
        assert "general" in INTENTS

    def test_intent_limits_defined(self):
        """所有意图的 recursion_limit 已配置"""
        from agent.graph import INTENTS, INTENT_LIMITS

        for intent in INTENTS:
            assert intent in INTENT_LIMITS, f"{intent} 缺少 limit 配置"

    def test_intent_guides_defined(self):
        """所有意图的指南已配置"""
        from agent.graph import INTENTS, INTENT_GUIDE

        for intent in INTENTS:
            assert intent in INTENT_GUIDE, f"{intent} 缺少 guide 配置"


class TestBuildGraph:
    def test_build_graph_structure(self):
        """构建图结构验证"""
        from agent.graph import build_graph

        graph = build_graph()
        assert graph is not None

        # 检查图节点
        graph_def = graph.get_graph()
        nodes = set()
        for item in graph_def.nodes:
            if isinstance(item, tuple):
                nodes.add(item[0])
            else:
                nodes.add(item)
        assert "classify" in nodes
        for intent in ["what-is", "how-to", "general"]:
            assert f"run_{intent}" in nodes

    def test_get_graph_singleton(self):
        """get_graph() 返回单例"""
        from agent.graph import get_graph

        g1 = get_graph()
        g2 = get_graph()
        assert g1 is g2  # 同一实例

    def test_graph_has_conditional_edges(self):
        """图包含条件边（意图路由）"""
        from agent.graph import build_graph

        graph = build_graph()
        # 验证图至少有 classify → 条件路由 → run_* 的结构
        graph_def = graph.get_graph()
        edges = list(graph_def.edges)
        # LangGraph 至少有 entry → classify → ... → END
        assert len(edges) >= 3


class TestClassifyIntent:
    """意图分类测试（mock LLM）"""

    def test_classify_known_intent(self):
        """已知意图正确分类"""
        from agent.graph import classify_intent

        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "how-to"

        with patch("agent.graph.build_llm", return_value=mock_llm):
            result = classify_intent({"question": "怎么配置数据库", "project": "", "intent": "", "messages": []})
            assert result["intent"] == "how-to"

    def test_classify_unknown_intent_falls_to_general(self):
        """未知意图回退到 general"""
        from agent.graph import classify_intent

        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "unknown-intent"

        with patch("agent.graph.build_llm", return_value=mock_llm):
            result = classify_intent({"question": "随便问问", "project": "", "intent": "", "messages": []})
            assert result["intent"] == "general"

    def test_classify_case_insensitive(self):
        """意图分类大小写不敏感"""
        from agent.graph import classify_intent

        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "WHERE-IS"

        with patch("agent.graph.build_llm", return_value=mock_llm):
            result = classify_intent({"question": "文件在哪", "project": "", "intent": "", "messages": []})
            assert result["intent"] == "where-is"
