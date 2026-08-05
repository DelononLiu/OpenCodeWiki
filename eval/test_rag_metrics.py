"""rag_metrics 纯函数单测：不依赖后端与网络，LLM 调用全部 mock。"""

import json

import pytest

try:
    from eval.rag_metrics import (
        aggregate, context_precision_id, context_precision_ranked,
        context_recall_id, context_recall_llm, faithfulness, llm_judge,
        match_retrieved, parse_claims_response,
    )
except ImportError:  # 从 eval/ 目录直接运行
    from rag_metrics import (
        aggregate, context_precision_id, context_precision_ranked,
        context_recall_id, context_recall_llm, faithfulness, llm_judge,
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


# ── LLM 环境变量（OPENAI_* 优先，LLM_* 回退）──

class _FakeResponse:
    """模拟 urllib 响应对象（可作上下文管理器）。"""

    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload.encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _capture_request(monkeypatch):
    """把 urlopen 换成记录器，返回 captured 字典。"""
    captured = {}

    def fake_urlopen(req, timeout=60):
        captured["url"] = req.full_url
        captured["auth"] = req.headers.get("Authorization")
        captured["body"] = json.loads(req.data.decode())
        return _FakeResponse('{"choices": [{"message": {"content": "ok"}}]}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    return captured


def test_llm_judge_prefers_openai_env_over_llm_env(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("LLM_MODEL", "llm-old")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm-old.example")
    monkeypatch.setenv("LLM_API_KEY", "sk-llm-old")

    captured = _capture_request(monkeypatch)
    assert llm_judge([{"role": "user", "content": "hi"}]) == "ok"
    assert captured["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert captured["auth"] == "Bearer sk-openai"
    assert captured["body"]["model"] == "deepseek-v4-flash"


def test_llm_judge_falls_back_to_llm_env(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("LLM_MODEL", "llm-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "sk-llm")

    captured = _capture_request(monkeypatch)
    assert llm_judge([{"role": "user", "content": "hi"}]) == "ok"
    assert captured["url"] == "https://llm.example/v1/chat/completions"
    assert captured["auth"] == "Bearer sk-llm"
    assert captured["body"]["model"] == "llm-model"


def test_llm_judge_explicit_args_override_env(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "env-model")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://env.example/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")

    captured = _capture_request(monkeypatch)
    assert llm_judge(
        [{"role": "user", "content": "hi"}],
        model="arg-model",
        base_url="https://arg.example/v1",
        api_key="sk-arg",
    ) == "ok"
    assert captured["url"] == "https://arg.example/v1/chat/completions"
    assert captured["auth"] == "Bearer sk-arg"
    assert captured["body"]["model"] == "arg-model"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
