#!/usr/bin/env python3
"""RAG 数值指标：Context Precision / Context Recall（ID 版）+ Faithfulness / Context Recall（LLM 版）。

对标 RAGAS 指标，做落地化简化：
- Context Precision / Context Recall 用 golden_files 与检索来源做 ID 匹配
  （对应官方 IDBasedContextPrecision / IDBasedContextRecall），零 LLM 成本、稳定可复现；
- Faithfulness / Context Recall(LLM) 复用 eval/score.py 的 LLM judge 模式：
  把文本拆成 claims → 逐条判定是否被检索上下文支撑，按 RAGAS 公式算分。

所有函数尽量纯函数化，LLM 调用通过 judge 函数注入，便于单元测试与 mock。
"""

import json
import os
import urllib.request


# ── ID 版指标（确定性，无 LLM）──

def _golden_list(golden_files):
    return [g.lower() for g in (golden_files or []) if g]


def _hit_count(retrieved_titles, golden_files):
    """统计检索结果中命中了 golden_files 的数量（子串匹配，不区分大小写）。"""
    golden = _golden_list(golden_files)
    if not golden:
        return 0
    return sum(
        1 for t in (retrieved_titles or [])
        if any(g in str(t).lower() for g in golden)
    )


def match_retrieved(retrieved_titles, golden_files):
    """返回被检索命中的 golden 文件集合（小写）。"""
    golden = _golden_list(golden_files)
    matched = set()
    for t in (retrieved_titles or []):
        tl = str(t).lower()
        for g in golden:
            if g in tl:
                matched.add(g)
    return matched


def context_precision_id(retrieved_titles, golden_files):
    """ID 版 Context Precision = 命中检索项 / 总检索项；无检索结果返回 None。"""
    if not retrieved_titles:
        return None
    return _hit_count(retrieved_titles, golden_files) / len(retrieved_titles)


def context_precision_ranked(retrieved_titles, golden_files):
    """RAGAS 式排序加权精度：相关项越靠前分越高。

    ContextPrecision@K = Σ_k (Precision@k × v_k) / 前 K 内相关项总数，
    其中 Precision@k = TP@k / k，v_k 为第 k 位是否相关。
    """
    golden = _golden_list(golden_files)
    if not retrieved_titles or not golden:
        return None
    relevant_total = 0
    score = 0.0
    for k, t in enumerate(retrieved_titles, start=1):
        tl = str(t).lower()
        is_rel = any(g in tl for g in golden)
        if not is_rel:
            continue
        relevant_total += 1
        tp_at_k = sum(
            1 for t2 in retrieved_titles[:k]
            if any(g in str(t2).lower() for g in golden)
        )
        score += tp_at_k / k
    if relevant_total == 0:
        return 0.0
    return score / relevant_total


def context_recall_id(retrieved_titles, golden_files):
    """ID 版 Context Recall = 命中 golden 数 / golden 总数；无 golden 返回 None。"""
    golden = _golden_list(golden_files)
    if not golden:
        return None
    return _hit_count(retrieved_titles, golden_files) / len(golden)


def aggregate(scores):
    """求均值，忽略 None；全空返回 None。"""
    vals = [s for s in scores if s is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


# ── LLM judge（OpenAI 兼容 chat completion，与 score.py 同款调用）──

def llm_judge(messages, model="", base_url="", api_key="", temperature=0):
    """调用 chat/completions，返回 message content（兼容 reasoning_content）。"""
    body = json.dumps({
        "model": model or os.environ.get("LLM_MODEL", "gpt-4o-mini"),
        "messages": messages,
        "max_tokens": 1500,
        "temperature": temperature,
    }).encode()
    req = urllib.request.Request(
        (base_url or os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")) + "/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (api_key or os.environ.get("LLM_API_KEY", "")),
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    msg = data["choices"][0]["message"]
    return msg.get("content", "") or msg.get("reasoning_content", "") or ""


# ── LLM 版指标（Faithfulness / Context Recall）──

_CLAIMS_PROMPT = """你是严格的 RAG 评测助手。请把下面的{label}拆成相互独立的陈述（claims），
并逐条判断该陈述是否可以被“检索上下文”直接支撑（允许合理推断，但不允许上下文之外的事实）。

检索上下文：
---
{context}
---

{label}：
---
{text}
---

只返回 JSON：{{"claims": ["..."], "supported": [true/false]}}，claims 与 supported 一一对应。"""


def parse_claims_response(raw):
    """从 LLM 输出提取 {"claims": [...], "supported": [...]}；解析失败返回 None。

    兼容输出前后带解释文字；claims/supported 长度不一致时按较短者截断。
    """
    if not raw:
        return None
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    claims = data.get("claims")
    supported = data.get("supported")
    if not isinstance(claims, list) or not claims:
        return None
    if not isinstance(supported, list):
        return None
    n = min(len(claims), len(supported))
    if n == 0:
        return None
    return claims[:n], [bool(s) for s in supported[:n]]


def _claims_supported(text, context_text, judge, label):
    """拆 claims 并判定支撑率；judge(messages) -> LLM 原始输出。"""
    prompt = _CLAIMS_PROMPT.format(
        label=label,
        context=context_text[:12000],
        text=text[:6000],
    )
    raw = judge([{"role": "user", "content": prompt}])
    parsed = parse_claims_response(raw)
    if parsed is None:
        return None
    claims, supported = parsed
    return sum(supported) / len(claims)


def faithfulness(answer, context_text, judge):
    """Faithfulness = 回答中被检索上下文支撑的 claims 比例（0~1）。"""
    if not answer or not context_text:
        return None
    return _claims_supported(answer, context_text, judge, "待评估回答")


def context_recall_llm(reference, context_text, judge):
    """Context Recall(LLM) = 参考答案中被检索上下文覆盖的 claims 比例（0~1）。"""
    if not reference or not context_text:
        return None
    return _claims_supported(reference, context_text, judge, "参考答案")
