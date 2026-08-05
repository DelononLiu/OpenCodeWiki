#!/usr/bin/env python3
"""RAG 指标评测运行器：逐题调用 /api/qa，采集回答与检索来源，计算数值指标并输出记分卡。

用法：
  1) 先启动后端（仓库根执行）：
     backend/.venv/bin/python -m uvicorn backend.main:app --port 8100
  2) 运行评测：
     python3 eval/run_rag_eval.py --user alice --password pw123
     # 只算检索侧 ID 指标、不调 LLM judge：
     python3 eval/run_rag_eval.py --user alice --password pw123 --skip-llm
  3) 结果写入 eval/results/rag_baseline.json，控制台打印记分卡

指标：
  context_precision   RAGAS 排序加权精度（ID 版，基于 golden_files）
  context_recall      ID 版召回（golden_files 覆盖）
  faithfulness        LLM 判“回答 claims 是否被检索上下文支撑”
  context_recall_llm  LLM 判“参考答案 claims 是否被检索上下文覆盖”
"""

import argparse
import datetime
import json
import os
import sys

import requests

from eval import rag_metrics

HERE = os.path.dirname(os.path.abspath(__file__))


def login(base, username, password):
    """登录并返回 Bearer token。"""
    resp = requests.post(
        f"{base}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"登录失败: {data.get('error', '未知错误')}")
    return data["token"]


def stream_qa(base, token, question, kb_id):
    """调用 /api/qa（SSE），返回 (answer, session_id)。"""
    resp = requests.post(
        f"{base}/api/qa",
        json={"question": question, "kb_id": kb_id},
        headers={"Authorization": f"Bearer {token}"},
        stream=True,
        timeout=180,
    )
    resp.raise_for_status()

    answer_parts = []
    session_id = None
    current_event = ""
    for line in resp.iter_lines(decode_unicode=True):
        line = line or ""
        if line.startswith("event: "):
            current_event = line[7:].strip()
        elif line.startswith("data: "):
            try:
                data = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if current_event == "token" and data.get("text"):
                answer_parts.append(data["text"])
            elif current_event == "session":
                session_id = data.get("session_id")
            elif current_event == "error":
                raise RuntimeError(f"QA 错误: {data.get('message')}")
    return "".join(answer_parts), session_id


def fetch_sources(base, token, session_id):
    """拉取会话消息，返回助手消息的 sources 列表（[{doc_title, chunk_id, content, score}]）。"""
    resp = requests.get(
        f"{base}/api/sessions/{session_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    for m in data.get("messages", []):
        if m.get("role") == "assistant":
            try:
                sources = json.loads(m.get("sources") or "[]")
            except json.JSONDecodeError:
                sources = []
            return [s for s in sources if isinstance(s, dict)]
    return []


def scorecard(summary):
    """打印记分卡。"""
    m = summary["metrics"]
    print(f"\n===== RAG 指标记分卡（{summary['cases']} 题 · {summary['date']}）=====")
    print(f"context_precision   排序加权精度:  {m.get('context_precision')}")
    print(f"context_recall      ID 版召回:       {m.get('context_recall')}")
    print(f"faithfulness        回答支撑率:      {m.get('faithfulness')}")
    print(f"context_recall_llm  参考覆盖率:      {m.get('context_recall_llm')}")


def main():
    parser = argparse.ArgumentParser(description="RAG 指标评测运行器")
    parser.add_argument("--base", default="http://localhost:8100", help="后端地址")
    parser.add_argument("--token", default=os.environ.get("QA_EVAL_TOKEN", ""), help="已有登录 token")
    parser.add_argument("--user", default=os.environ.get("QA_EVAL_USER", ""), help="登录用户名")
    parser.add_argument("--password", default=os.environ.get("QA_EVAL_PASSWORD", ""), help="登录密码")
    parser.add_argument("--cases", default=os.path.join(HERE, "datasets", "qa_cases.json"))
    parser.add_argument("--out", default=os.path.join(HERE, "results", "rag_baseline.json"))
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 题（0=全部）")
    parser.add_argument("--skip-llm", action="store_true", help="只算 ID 版检索指标，不调 LLM judge")
    args = parser.parse_args()

    cases = json.load(open(args.cases, encoding="utf-8"))
    if args.limit:
        cases = cases[:args.limit]
    if not cases:
        print("题目集为空", file=sys.stderr)
        sys.exit(1)

    token = args.token or login(args.base, args.user, args.password)
    judge = None if args.skip_llm else rag_metrics.llm_judge

    per_case = []
    for i, case in enumerate(cases, 1):
        print(f"[{i}/{len(cases)}] {case['id']} {case['question'][:40]}", flush=True)
        answer, session_id = stream_qa(args.base, token, case["question"], case["kb_id"])
        sources = fetch_sources(args.base, token, session_id) if session_id else []
        titles = [s.get("doc_title", "") for s in sources]
        context_text = "\n".join(f"[{s.get('doc_title', '')}] {s.get('content', '')}" for s in sources)
        golden = case.get("golden_files", [])

        row = {
            "id": case["id"],
            "intent": case["intent"],
            "question": case["question"],
            "answer_len": len(answer),
            "retrieved_count": len(titles),
            "retrieved_titles": titles[:10],
            "context_precision": rag_metrics.context_precision_ranked(titles, golden),
            "context_recall": rag_metrics.context_recall_id(titles, golden),
        }
        if judge and context_text:
            row["faithfulness"] = rag_metrics.faithfulness(answer, context_text, judge)
            row["context_recall_llm"] = rag_metrics.context_recall_llm(case.get("reference", ""), context_text, judge)
        per_case.append(row)

    summary = {
        "date": datetime.datetime.now().isoformat(timespec="seconds"),
        "cases": len(per_case),
        "metrics": {
            "context_precision": rag_metrics.aggregate([r.get("context_precision") for r in per_case]),
            "context_recall": rag_metrics.aggregate([r.get("context_recall") for r in per_case]),
            "faithfulness": rag_metrics.aggregate([r.get("faithfulness") for r in per_case]),
            "context_recall_llm": rag_metrics.aggregate([r.get("context_recall_llm") for r in per_case]),
        },
    }

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "cases": per_case}, f, ensure_ascii=False, indent=2)
    scorecard(summary)
    print(f"\n结果已写入: {args.out}")


if __name__ == "__main__":
    main()
