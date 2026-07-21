"""
store_qa.py — QA entry CRUD operations.
Replaces qa-store.ts from Node.js era.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from database import get_qa_db


def get_next_qid() -> int:
    db = get_qa_db()
    row = db.execute("SELECT COALESCE(MAX(qid), 0) + 1 AS next FROM qa_entries").fetchone()
    return row["next"]


def create_entry(data: dict) -> dict:
    db = get_qa_db()
    eid = data.get("id") or str(uuid.uuid4())
    qid = data.get("qid") or get_next_qid()
    session_id = data.get("session_id") or data.get("sessionId") or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO qa_entries
           (id, qid, session_id, repo, question, answer, mode, domain,
            status, sources, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            eid, qid,
            session_id,
            data.get("repo", ""),
            data.get("question", ""),
            data.get("answer"),
            data.get("mode", "deep"),
            data.get("domain", "general"),
            "pending",
            json.dumps(data.get("sources", [])),
            json.dumps(data.get("tags", [])),
            now, now,
        ),
    )
    db.commit()
    return {"id": eid, "qid": qid, "session_id": session_id}


def update_entry_answer(qid: int, answer: str, sources: list | None = None):
    """流式回答完成后，更新条目的回答内容和引用来源。"""
    db = get_qa_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE qa_entries SET answer = ?, sources = ?, status = 'active', updated_at = ? WHERE qid = ?",
        (answer, json.dumps(sources or []), now, qid),
    )
    db.commit()


def _parse_json(val: str | None, default: list = None) -> list:
    if not val:
        return default or []
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default or []


def get_entry(qid: int) -> dict | None:
    db = get_qa_db()
    row = db.execute("SELECT * FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not row:
        return None
    entry = dict(row)
    entry["tags"] = _parse_json(entry.get("tags"))
    entry["sources"] = _parse_json(entry.get("sources"))
    entry["related_qids"] = _parse_json(entry.get("related_qids"))
    # Check calibrated
    cal = db.execute(
        "SELECT * FROM calibrated_answers WHERE qa_entry_id = ? ORDER BY version DESC LIMIT 1",
        (entry["id"],),
    ).fetchone()
    entry["is_calibrated"] = cal is not None
    entry["calibrated_answer"] = dict(cal) if cal else None
    return entry


def list_entries(query: dict) -> dict:
    db = get_qa_db()
    conditions = []
    params: list[Any] = []

    if query.get("repo"):
        conditions.append("repo = ?")
        params.append(query["repo"])
    if query.get("status"):
        conditions.append("status = ?")
        params.append(query["status"])
    if query.get("calibrated"):
        conditions.append("id IN (SELECT qa_entry_id FROM calibrated_answers)")
    if query.get("domain"):
        conditions.append("domain = ?")
        params.append(query["domain"])

    # Only root entries per session: first message in each session
    conditions.append(
        "(session_id = '' OR qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = qa_entries.session_id))"
    )
    where = " AND ".join(conditions) if conditions else "1=1"
    sort_map = {"latest": "created_at DESC", "popular": "visit_count DESC", "visit": "visit_count DESC"}
    order = sort_map.get(query.get("sort", ""), "created_at DESC")
    limit = min(query.get("limit", 20), 100)
    page = max(query.get("page", 1), 1)
    offset = (page - 1) * limit

    rows = db.execute(
        f"SELECT * FROM qa_entries WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    total = db.execute(
        f"SELECT COUNT(*) AS cnt FROM qa_entries WHERE {where}", params
    ).fetchone()["cnt"]

    entries = []
    for row in rows:
        e = dict(row)
        e["tags"] = _parse_json(e.get("tags"))
        e["sources"] = _parse_json(e.get("sources"))
        e["related_qids"] = _parse_json(e.get("related_qids"))
        cal = db.execute(
            "SELECT COUNT(*) AS c FROM calibrated_answers WHERE qa_entry_id = ?",
            (e["id"],),
        ).fetchone()
        e["is_calibrated"] = cal["c"] > 0
        entries.append(e)

    return {"entries": entries, "total": total, "page": page, "limit": limit}


def list_pending(repo: str | None = None) -> list[dict]:
    db = get_qa_db()
    if repo:
        rows = db.execute(
            "SELECT qid, question, created_at FROM qa_entries WHERE status = 'pending' AND repo = ? ORDER BY created_at DESC",
            (repo,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT qid, question, repo, created_at FROM qa_entries WHERE status = 'pending' ORDER BY created_at DESC",
        ).fetchall()
    return [dict(r) for r in rows]


def calibrate(qid: int, answer: str, calibrator: str = "admin") -> bool:
    db = get_qa_db()
    entry = db.execute("SELECT id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return False
    cal_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO calibrated_answers (id, qa_entry_id, answer, calibrator, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)""",
        (cal_id, entry["id"], answer, calibrator, now, now),
    )
    db.execute(
        "UPDATE qa_entries SET status = 'active', answer = ?, answered_at = ?, updated_at = ? WHERE id = ?",
        (answer, now, now, entry["id"]),
    )
    db.commit()
    return True


def search_questions(q: str, limit: int = 5) -> list[dict]:
    db = get_qa_db()
    rows = db.execute(
        "SELECT qid, question FROM qa_entries WHERE question LIKE ? ORDER BY visit_count DESC LIMIT ?",
        (f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]


def bump_visit(qid: int):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET visit_count = visit_count + 1 WHERE qid = ?", (qid,))
    db.commit()


def update_domain(qid: int, domain: str):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET domain = ? WHERE qid = ?", (domain, qid))
    db.commit()


def list_followups(qid: int) -> list[dict]:
    """返回同一 session 中除根消息外的所有追问，按时间正序。"""
    db = get_qa_db()
    entry = db.execute("SELECT session_id FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return []
    session_id = entry["session_id"]
    if session_id:
        rows = db.execute(
            "SELECT qid, question, answer, created_at FROM qa_entries "
            "WHERE session_id = ? AND qid != ? "
            "ORDER BY created_at ASC",
            (session_id, qid),
        ).fetchall()
    else:
        # Legacy: entries with empty session_id, fallback to parent_qid
        rows = db.execute(
            "SELECT qid, question, answer, created_at FROM qa_entries "
            "WHERE parent_qid = ? "
            "ORDER BY created_at ASC",
            (qid,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_session_messages(session_id: str) -> list[dict]:
    """返回某个 session 的所有消息（全部轮次），按时间正序，含 sources。"""
    db = get_qa_db()
    rows = db.execute(
        "SELECT qid, question, answer, status, sources, created_at, session_id "
        "FROM qa_entries WHERE session_id = ? "
        "ORDER BY created_at ASC",
        (session_id,),
    ).fetchall()
    result = []
    for r in rows:
        entry = dict(r)
        entry["sources"] = _parse_json(entry.get("sources"))
        result.append(entry)
    return result


def list_sessions() -> list[dict]:
    """返回所有 session 摘要，按时间倒序。"""
    db = get_qa_db()
    rows = db.execute(
        "SELECT q.session_id, q.qid AS root_qid, q.question AS root_question, q.created_at, "
        "(SELECT COUNT(*) FROM qa_entries e2 WHERE e2.session_id = q.session_id) AS message_count, "
        "st.topic_slug "
        "FROM qa_entries q "
        "LEFT JOIN session_topics st ON st.session_id = q.session_id "
        "WHERE q.session_id != '' "
        "AND q.qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = q.session_id) "
        "ORDER BY q.created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def get_sources(qid: int) -> list[dict]:
    """返回某个 QA 条目的参考引用来源。"""
    db = get_qa_db()
    row = db.execute("SELECT sources FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not row:
        return []
    return _parse_json(row["sources"])


def get_related(qid: int, limit: int = 5) -> list[dict]:
    """返回同 topic 的其他 QA 问题（排除 #general），不足时按关键词回退搜索。"""
    db = get_qa_db()
    entry = db.execute("SELECT session_id, question FROM qa_entries WHERE qid = ?", (qid,)).fetchone()
    if not entry:
        return []
    sid = entry["session_id"]
    question = entry["question"]

    # 1. 先用 topic 匹配
    rows = db.execute(
        "SELECT DISTINCT e.qid, e.question, e.status, e.created_at "
        "FROM qa_entries e "
        "JOIN session_topics st ON st.session_id = e.session_id "
        "WHERE st.topic_slug IN ("
        "  SELECT topic_slug FROM session_topics WHERE session_id = ? AND topic_slug != 'general'"
        ") AND e.session_id != ? "
        "AND e.session_id != '' "
        "AND e.qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = e.session_id) "
        "ORDER BY e.created_at DESC "
        "LIMIT ?",
        (sid, sid, limit),
    ).fetchall()
    results = [dict(r) for r in rows]

    # 2. 不足 3 条时降级为关键词 LIKE 搜索
    if len(results) < 3:
        # 简单去停用词提取关键词
        stop_words = {"的", "了", "在", "是", "我", "有", "和", "就", "不",
                      "人", "都", "一", "个", "上", "也", "很", "到", "说",
                      "要", "去", "你", "会", "着", "没有", "看", "好",
                      "自己", "这", "他", "她", "它", "们", "什么", "怎么",
                      "如何", "为什么", "哪个", "怎样", "请问", "这个", "那个",
                      "the", "a", "an", "is", "are", "was", "were", "be",
                      "been", "being", "have", "has", "had", "do", "does",
                      "did", "will", "would", "can", "could", "may", "might",
                      "shall", "should", "to", "of", "in", "for", "on",
                      "with", "at", "by", "from", "as", "into", "through",
                      "during", "before", "after", "about", "between",
                      "this", "that", "these", "those", "it", "its"}
        # 分词取关键词（按空格/标点分割，过滤停用词和短词）
        import re
        words = set()
        for token in re.split(r'[\s,，。.？?！!；;：:""''、/\\()（）\[\]{}]+', question):
            token = token.strip().lower()
            if len(token) > 1 and token not in stop_words:
                words.add(token)

        # 尝试用关键词搜索，排除当前 session 和当前 qid
        seen_qids = {r["qid"] for r in results}
        seen_qids.add(qid)
        for kw in words:
            if len(results) >= 3:
                break
            kw_rows = db.execute(
                "SELECT e.qid, e.question, e.status, e.created_at "
                "FROM qa_entries e "
                "WHERE e.question LIKE ? AND e.session_id != ? AND e.qid != ? "
                "AND e.qid = (SELECT MIN(e2.qid) FROM qa_entries e2 WHERE e2.session_id = e.session_id) "
                "AND e.session_id != '' "
                "LIMIT 3",
                (f"%{kw}%", sid, qid),
            ).fetchall()
            for r in kw_rows:
                if r["qid"] not in seen_qids:
                    seen_qids.add(r["qid"])
                    results.append(dict(r))
                    if len(results) >= limit:
                        break

    return results[:limit]


def save_feedback(qid: int, fb: str) -> bool:
    """保存用户反馈。"""
    if fb not in ("accepted", "rejected"):
        return False
    db = get_qa_db()
    cur = db.execute("UPDATE qa_entries SET feedback = ? WHERE qid = ?", (fb, qid))
    db.commit()
    return cur.rowcount > 0


def match_topic(session_id: str, question: str, answer: str):
    """LLM 匹配 topic，写入 session_topics。从 knowledge.db 获取已有 topics 列表。"""
    from database import get_knowledge_db
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    kdb = get_knowledge_db()
    topics = kdb.execute("SELECT slug, name FROM topics").fetchall()
    if not topics:
        return

    topic_list = "\n".join(f"- {t['slug']}: {t['name']}" for t in topics)
    llm = build_llm(get_llm_config())
    prompt = (
        f"问题：{question}\n回答：{answer[:500]}\n\n"
        f"已有主题列表：\n{topic_list}\n\n"
        f"从列表中选择最匹配的主题 slug。如果没有匹配的，输出 general。只输出 slug 名称。"
    )
    resp = llm.invoke(prompt)
    slug = resp.content.strip().lower()
    if slug not in {t["slug"] for t in topics}:
        slug = "general"

    db = get_qa_db()
    db.execute(
        "INSERT OR IGNORE INTO session_topics (session_id, topic_slug) VALUES (?, ?)",
        (session_id, slug),
    )
    db.commit()


def refine_title_and_tags(qid: int) -> dict | None:
    """用 LLM 精炼 QA 条目的标题（15 字内）和 3-5 个标签。"""
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    db = get_qa_db()
    row = db.execute(
        "SELECT qid, question, answer FROM qa_entries WHERE qid = ?",
        (qid,),
    ).fetchone()
    if not row:
        return None

    question = row["question"]
    answer = (row["answer"] or "")[:800]

    llm = build_llm(get_llm_config())
    prompt = (
        f"原始问题：{question}\n"
        f"回答摘要：{answer}\n\n"
        f"任务：\n"
        f"1. 生成一个标准化的标题（15 字以内），概括该问答的核心内容\n"
        f"2. 提取 3-5 个标签（关键词，中文或英文，每个 2-6 字）\n\n"
        f"输出格式 JSON：{{\"title\": \"...\", \"tags\": [\"...\", \"...\"]}}\n"
        f"只输出 JSON，不要其他内容。"
    )
    try:
        resp = llm.invoke(prompt)
        content = resp.content.strip()
        # 去掉可能的 markdown 代码块标记
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            content = content.rsplit("\n", 1)[0]
            if content.endswith("```"):
                content = content[:-3]
        data = json.loads(content)
        title = data.get("title", "").strip()
        tags = data.get("tags", [])
        if not title:
            return None

        # 更新数据库
        db.execute(
            "UPDATE qa_entries SET question = ?, tags = ?, updated_at = ? WHERE qid = ?",
            (title, json.dumps(tags), datetime.now(timezone.utc).isoformat(), qid),
        )
        db.commit()
        return {"qid": qid, "title": title, "tags": tags}
    except Exception:
        return None


def convert_session_to_wiki(session_id: str, module_slug: str = "") -> dict:
    """将整个 session 的多轮对话转换为结构化 wiki 专题文档。

    1. 拉取 session 所有 QA
    2. LLM 生成专题格式 markdown（概述→架构→核心逻辑→代码引用→流程图）
    3. write_page + index_wiki_page
    4. 记录到 wiki_conversions 表

    返回 {slug, title, content, qa_count}
    """
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm
    from stores.wiki import write_page, index_wiki_page

    # 1. 拉取 session 所有对话
    messages = list_session_messages(session_id)
    if not messages:
        raise ValueError("Session has no messages")

    # 2. 构建 LLM 输入
    qa_text = ""
    for i, m in enumerate(messages):
        qa_text += f"\n### Q{i+1}: {m.get('question', '')}\n\n"
        answer = m.get("answer") or ""
        # 截断过长的回答
        if len(answer) > 2000:
            answer = answer[:2000] + "...(truncated)"
        qa_text += f"{answer}\n"
        sources = m.get("sources")
        if isinstance(sources, list) and sources:
            qa_text += "\n引用来源:\n"
            for s in sources[:8]:
                qa_text += f"- {s.get('file', '')}:{s.get('line', '')}\n"

    llm = build_llm(get_llm_config())
    prompt = (
        "你是一个技术文档撰写专家。请根据以下多轮代码问答对话，撰写一篇结构化 Wiki 技术专题文档。\n\n"
        "## 原始问答对话\n"
        f"{qa_text}\n\n"
        "## 要求\n"
        "1. **不要保留问答格式**，综合成结构化的专题文档\n"
        "2. 按以下结构组织：\n"
        "   - 概述（一句话说明这个专题讲什么）\n"
        "   - 核心架构/概念\n"
        "   - 关键实现细节（可含代码片段和文件引用）\n"
        "   - 流程说明（如适用，用 mermaid 流程图）\n"
        "3. 从内容中提取一个英文短横线 slug（如 kcode-plugin-system），作为文档标识\n"
        "4. 生成一个中文标题（15 字以内）\n\n"
        "输出格式（严格 JSON，不要额外内容）：\n"
        '{"slug": "...", "title": "...", "content": "markdown..."}'
    )

    try:
        resp = llm.invoke(prompt)
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw[:-3]
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"LLM 输出非 JSON 格式: {str(e)[:200]}")
    except Exception as e:
        raise RuntimeError(f"LLM 生成 wiki 失败: {str(e)[:200]}")

    slug = data.get("slug", f"session-{session_id[:8]}")
    title = data.get("title", "未命名专题")
    content = data.get("content", "")

    if not content:
        raise RuntimeError("LLM 生成内容为空")

    # 3. 写入 wiki
    write_page(slug, "qa-archive", content)
    index_wiki_page(slug, content)

    # 4. 记录转换
    import uuid
    db = get_qa_db()
    conv_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO wiki_conversions (id, session_id, wiki_slug, wiki_title, module_slug, qa_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (conv_id, session_id, slug, title, module_slug, len(messages), now),
    )
    db.commit()

    return {
        "slug": slug,
        "title": title,
        "content": content,
        "qa_count": len(messages),
    }
