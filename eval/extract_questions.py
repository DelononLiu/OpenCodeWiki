#!/usr/bin/env python3
"""抽取真实问答记录作为评测候选题（去重 + 意图粗标）。

数据源：
1. knora.db 的 sessions + messages（role='user' 的消息即用户问题）
2. 遗留 qa.db 的 qa_entries.question

输出 JSON 候选集，字段：
  id / question / count（被问次数）/ intent（关键词启发式猜测，供人工复核）/
  sources（来源消息或条目 id）/ kb_ids（涉及的知识库）

用法：
  python3 eval/extract_questions.py
"""

import argparse
import json
import os
import re
import sqlite3
from collections import Counter

MIN_LEN = 5
MAX_LEN = 500

# 礼貌前缀：归一化时剥离，便于合并同一问题
_PREFIXES = ("请问", "帮我", "你好", "请", "hi", "Hi", "HI")

# 噪声过滤：纯算术题、编号片段（从文档复制的列表项）
_NOISE_PATTERNS = [
    r"^[\d\s+\-*/().，,=？?]+$",   # 纯算术
    r"^\d+[\.、]\s*\S",            # 编号片段
    r"^\d+\s*[+\-*/]\s*\d+",       # 算术题（1+1 形式）
    r"^(测试|test\b)",             # 聊天测试消息
]

# 意图关键词（启发式，中英混合；顺序即优先级）
_INTENT_PATTERNS = [
    ("what-is", "什么是|是什么|啥是|有哪些|有什么|支持什么|包含哪些|介绍一下|介绍下|是做什么的|区别|关系|差异|作用|含义|What is|What are|difference|relationship"),
    ("where-is", "在哪|哪里|位置|路径|哪个文件|哪个类|哪个函数|Where|which file|located"),
    ("how-to", "怎么|如何|怎样|How to|how do|怎么实现|怎么配置|怎么用"),
    ("why", "为什么|为何|原因|Why"),
]


def normalize(text):
    """归一化：剥离礼貌前缀、折叠空白、去尾部标点。"""
    t = (text or "").strip()
    for prefix in _PREFIXES:
        if t.startswith(prefix):
            t = t[len(prefix):].lstrip("：:，, ")
            break
    t = re.sub(r"\s+", " ", t)
    return t.rstrip("？?。.!！")


def guess_intent(question):
    """按关键词猜测题目意图，供人工复核使用。"""
    q = question.lower()
    for intent, pattern in _INTENT_PATTERNS:
        if re.search(pattern, q):
            return intent
    return "other"


def is_valid_question(text):
    """过滤空串、过短/过长、无实质内容的题目。"""
    t = (text or "").strip()
    if len(t) < MIN_LEN or len(t) > MAX_LEN:
        return False
    if any(re.match(p, t) for p in _NOISE_PATTERNS):
        return False
    if not re.search(r"[\u4e00-\u9fffA-Za-z]", t):
        return False
    return True


def load_knora_questions(db_path):
    """从 knora.db 读取用户消息，返回 [(question, kb_id, msg_id)]。"""
    if not os.path.exists(db_path):
        return []
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return db.execute(
            "SELECT m.content, s.kb_id, m.id "
            "FROM messages m JOIN sessions s ON s.id = m.session_id "
            "WHERE m.role = 'user'"
        ).fetchall()
    finally:
        db.close()


def load_legacy_questions(db_path):
    """从遗留 qa.db 读取 qa_entries.question，返回 [(question, repo, id)]。"""
    if not os.path.exists(db_path):
        return []
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return db.execute(
            "SELECT question, repo, id FROM qa_entries WHERE question IS NOT NULL"
        ).fetchall()
    finally:
        db.close()


def build_candidates(rows):
    """去重 + 计数 + 意图标注。rows: [(question, kb_id, source_id)]"""
    by_q = {}
    for question, kb_id, source_id in rows:
        q = normalize(question)
        if not is_valid_question(q):
            continue
        entry = by_q.setdefault(q, {"question": q, "count": 0, "sources": [], "kb_ids": []})
        entry["count"] += 1
        entry["sources"].append(source_id)
        if kb_id and kb_id not in entry["kb_ids"]:
            entry["kb_ids"].append(kb_id)

    candidates = []
    for i, (q, d) in enumerate(
        sorted(by_q.items(), key=lambda kv: (-kv[1]["count"], kv[0])), 1
    ):
        candidates.append({
            "id": f"rq-{i:03d}",
            "question": d["question"],
            "count": d["count"],
            "intent": guess_intent(d["question"]),
            "sources": d["sources"][:20],
            "kb_ids": d["kb_ids"][:5],
        })
    return candidates


def main():
    parser = argparse.ArgumentParser(description="抽取真实问答记录为评测候选题")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/.opencodewiki"),
                        help="数据目录（含 knora.db / qa.db）")
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(here, "datasets", "real_questions_candidates.json")
    parser.add_argument("--out", default=default_out, help="候选集输出路径")
    args = parser.parse_args()

    knora = load_knora_questions(os.path.join(args.data_dir, "knora.db"))
    legacy = load_legacy_questions(os.path.join(args.data_dir, "qa.db"))
    candidates = build_candidates(knora + legacy)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(candidates, f, ensure_ascii=False, indent=2)

    print(f"原始问题数: knora={len(knora)} + 遗留={len(legacy)}")
    print(f"去重后候选: {len(candidates)}")
    print("意图分布:", dict(Counter(c["intent"] for c in candidates)))
    print(f"输出: {args.out}")
    print("\nTop 25（按提问次数）:")
    for c in candidates[:25]:
        print(f"  [{c['intent']}] x{c['count']}  {c['question'][:60]}")


if __name__ == "__main__":
    main()
