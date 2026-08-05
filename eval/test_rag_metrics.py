"""rag_metrics 纯函数单测：不依赖后端与网络，LLM 调用全部 mock。"""

import pytest

try:
    from eval.rag_metrics import (
        aggregate, context_precision_id, context_precision_ranked,
        context_recall_id, context_recall_llm, faithfulness,
        match_retrieved, parse_claims_response,
    )
except ImportError:  # 从 eval/ 目录直接运行
    from rag_metrics import (
        aggregate, context_precision_id, context_precision_ranked,
        context_recall_id, context_recall_llm, faithfulness,
        match_retrieved, parse_claims_response,
    )


# ── ID 版检索指标 ──

def test_match_retrieved_substring_and_case():
    matched = match_retrieved(
        ["OpenCodeWiki/README.md", "docs/ARCHITECTURE.md"],
        ["readme.md", "docs/ARCHITECTURE.md"],
    )
    assert matched == {"readme.md", "docs/architecture.md"}


def test_context_precision_id_partial():
    assert context_precision_id(["a.md", "b.md"], ["b.md"]) == 0.5


def test_context_precision_id_no_retrieval():
    assert context_precision_id([], ["b.md"]) is None


def test_context_precision_id_no_match():
    assert context_precision_id(["a.md"], ["b.md"]) == 0.0


def test_context_recall_id_partial():
    assert context_recall_id(["a.md", "b.md"], ["a.md", "c.md"]) == 0.5


def test_context_recall_id_empty_golden():
    assert context_recall_id(["a.md"], []) is None


def test_context_precision_ranked_relevant_second():
    # 相关项排第 2：Precision@1=0，Precision@2=1/2 → (0+0.5)/1 = 0.5
    assert context_precision_ranked(["x.md", "y.md"], ["y.md"]) == 0.5


def test_context_precision_ranked_relevant_first():
    assert context_precision_ranked(["y.md", "x.md"], ["y.md"]) == 1.0


def test_context_precision_ranked_none_relevant():
    assert context_precision_ranked(["x.md"], ["y.md"]) == 0.0


def test_context_precision_ranked_empty():
    assert context_precision_ranked([], ["y.md"]) is None


# ── 聚合 ──

def test_aggregate_ignores_none():
    assert aggregate([0.5, None, 1.0]) == 0.75


def test_aggregate_empty():
    assert aggregate([]) is None
    assert aggregate([None, None]) is None


# ── LLM 输出解析 ──

def test_parse_claims_response_with_extra_text():
    raw = '好的，结果如下：{"claims": ["a", "b"], "supported": [true, false]}'
    claims, supported = parse_claims_response(raw)
    assert claims == ["a", "b"]
    assert supported == [True, False]


def test_parse_claims_response_malformed():
    assert parse_claims_response("无法解析") is None
    assert parse_claims_response("") is None
    assert parse_claims_response('{"claims": []}') is None


def test_parse_claims_response_length_mismatch():
    claims, supported = parse_claims_response('{"claims": ["a","b","c"], "supported": [true]}')
    assert len(claims) == len(supported) == 1


# ── LLM 版指标（judge mock）──

def test_faithfulness_uses_judge_and_formula():
    calls = []

    def judge(messages):
        calls.append(messages)
        return '{"claims": ["c1", "c2"], "supported": [true, false]}'

    assert faithfulness("answer text", "context text", judge) == 0.5
    assert len(calls) == 1
    assert "检索上下文" in calls[0][0]["content"]


def test_faithfulness_requires_answer_and_context():
    def judge(messages):
        return '{"claims": ["c"], "supported": [true]}'

    assert faithfulness("", "ctx", judge) is None
    assert faithfulness("ans", "", judge) is None


def test_context_recall_llm_formula():
    def judge(messages):
        return '{"claims": ["r1", "r2"], "supported": [true, false]}'

    assert context_recall_llm("reference", "context", judge) == 0.5


def test_context_recall_llm_no_context():
    assert context_recall_llm("ref", "", lambda m: "") is None


def test_judge_parse_failure_returns_none():
    def judge(messages):
        return "模型拒绝回答"

    assert faithfulness("ans", "ctx", judge) is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
