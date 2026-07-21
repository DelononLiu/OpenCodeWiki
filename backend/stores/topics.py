"""
store_topics.py — Topic 聚合层 CRUD.
QA → Topic 聚合 → Draft 提炼 → Wiki 沉淀
"""

import json
from datetime import datetime, timezone

from database import get_knowledge_db


def list_topics(status: str | None = None) -> list[dict]:
    db = get_knowledge_db()
    if status:
        rows = db.execute("SELECT * FROM topics WHERE status = ? ORDER BY created_at DESC", (status,))
    else:
        rows = db.execute("SELECT * FROM topics ORDER BY created_at DESC")
    topics = [dict(r) for r in rows.fetchall()]
    for t in topics:
        cnt = db.execute("SELECT COUNT(*) AS c FROM topic_qa WHERE topic_slug = ?", (t["slug"],)).fetchone()
        t["qa_count"] = cnt["c"]
    return topics


def get_topic(slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topics WHERE slug = ?", (slug,)).fetchone()
    if not row:
        return None
    topic = dict(row)
    # Try to load QA entries — may fail if qa.db not initialized
    try:
        from database import get_qa_db
        qa_db = get_qa_db()
        qa_rows = db.execute(
            """SELECT q.qid, q.question, q.answer, q.created_at
               FROM topic_qa tq JOIN qa_entries q ON q.qid = tq.qid
               WHERE tq.topic_slug = ? ORDER BY q.created_at DESC""",
            (slug,),
        ).fetchall()
        topic["qa_entries"] = [dict(r) for r in qa_rows]
    except Exception:
        topic["qa_entries"] = []
    return topic


def create_topic(slug: str, name: str, description: str = "") -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT OR IGNORE INTO topics (slug, name, description, status, created_at) VALUES (?, ?, ?, 'pool', ?)",
        (slug, name, description, now),
    )
    db.commit()
    return {"slug": slug, "name": name, "status": "pool"}


def link_qa(topic_slug: str, qid: int):
    db = get_knowledge_db()
    db.execute("INSERT OR IGNORE INTO topic_qa (topic_slug, qid) VALUES (?, ?)", (topic_slug, qid))
    db.commit()


def save_draft(topic_slug: str, raw_content: str) -> dict:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT OR REPLACE INTO topic_drafts
           (topic_slug, raw_content, status, created_at)
           VALUES (?, ?, 'pending', ?)""",
        (topic_slug, raw_content, now),
    )
    db.commit()
    return {"topic_slug": topic_slug, "status": "pending"}


def get_draft(topic_slug: str) -> dict | None:
    db = get_knowledge_db()
    row = db.execute("SELECT * FROM topic_drafts WHERE topic_slug = ?", (topic_slug,)).fetchone()
    return dict(row) if row else None


def approve_draft(slug: str, wiki_module: str) -> bool:
    """审核通过：写 Wiki 文件 + 索引到 FTS5 + 发布 topic。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status, edited_content, raw_content FROM topic_drafts WHERE topic_slug = ?",
        (slug,),
    ).fetchone()
    if not row or row["status"] != "submitted":
        return False

    content = row["edited_content"] or row["raw_content"]

    # 写入 Wiki 文件
    from stores.wiki import write_page, index_wiki_page

    write_page(slug, "entity", content)

    # 索引到 FTS5
    index_wiki_page(slug, content)

    # 更新 draft 状态
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'approved', reviewed_at = ? WHERE topic_slug = ?",
        (now, slug),
    )
    db.commit()

    # 发布 topic
    publish(slug, wiki_module)
    return True


def update_draft_content(topic_slug: str, edited_content: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET edited_content = ?, updated_at = ? WHERE topic_slug = ?",
        (edited_content, now, topic_slug),
    )
    db.commit()
    return True


def publish(topic_slug: str, wiki_module: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topics SET status = 'published', wiki_module = ?, published_at = ? WHERE slug = ?",
        (wiki_module, now, topic_slug),
    )
    db.commit()
    return True


def search_topics(q: str, limit: int = 3) -> list[dict]:
    db = get_knowledge_db()
    rows = db.execute(
        "SELECT slug, name, description FROM topics WHERE slug LIKE ? OR name LIKE ? LIMIT ?",
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]


def analyze_qa_pool() -> dict:
    """LLM 扫描全量 active QA，按语义聚类建议 topic。"""
    from database import get_qa_db, get_knowledge_db
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    qa_db = get_qa_db()
    kdb = get_knowledge_db()

    # 获取所有 active QA
    rows = qa_db.execute(
        "SELECT qid, question, answer, domain FROM qa_entries WHERE status = 'active' ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    if not rows:
        return {"suggestions": [], "matched": [], "total_new": 0}

    # 获取已有 topics
    existing = kdb.execute("SELECT slug, name FROM topics").fetchall()
    existing_list = [dict(r) for r in existing]

    # 构建 prompt
    qa_list = "\n".join(
        f"Q{q['qid']}: {q['question'][:100]} | domain={q['domain']}"
        for q in rows
    )
    existing_str = "\n".join(
        f"- {t['slug']}: {t['name']}" for t in existing_list
    ) if existing_list else "(暂无已有主题)"

    llm = build_llm(get_llm_config())
    prompt = (
        f"你是一个知识管理助手。请分析以下 QA 条目，按语义将它们聚类为主题(Topic)。\n\n"
        f"## 已有主题\n{existing_str}\n\n"
        f"## 待分析的 QA\n{qa_list}\n\n"
        f"## 任务\n"
        f"1. 将语义相关的 QA 分组，每组生成一个 topic\n"
        f"2. 如果某组 QA 已有对应主题，直接关联到已有主题\n"
        f"3. 如果某条 QA 无法归类，忽略它\n\n"
        f"输出 JSON 数组，每个元素格式：\n"
        f'{{"slug": "topic-slug", "name": "主题名称", "description": "一句话描述", '
        f'"qa_ids": [1,2,3], "is_new": true/false}}\n\n'
        f"只输出 JSON 数组，不要其他内容。"
    )

    try:
        resp = llm.invoke(prompt)
        content = resp.content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:]) if lines[0].startswith("```") else content
            if content.endswith("```"):
                content = content[:-3]
        suggestions = json.loads(content)
    except Exception:
        return {"suggestions": [], "matched": [], "total_new": 0, "error": "LLM 分析失败"}

    new_count = 0
    matched_list = []
    new_list = []

    for item in suggestions:
        slug = item.get("slug", "").strip()
        name = item.get("name", "").strip()
        qa_ids = item.get("qa_ids", [])
        is_new = item.get("is_new", True)

        if not slug or not qa_ids:
            continue

        if is_new:
            create_topic(slug, name, item.get("description", ""))
            for qid in qa_ids:
                link_qa(slug, qid)
            new_list.append(item)
            new_count += 1
        else:
            for qid in qa_ids:
                link_qa(slug, qid)
            matched_list.append(item)

    return {
        "suggestions": new_list,
        "matched": matched_list,
        "total_new": new_count,
    }


DRAFT_TEMPLATE = """## 概述
{overview}

## 常见场景
{scenarios}

## 解决方案
{solutions}

## 注意事项
{notes}"""


def generate_draft_for_topic(slug: str) -> dict | None:
    """LLM 按模板总结 topic 下所有 QA，生成结构化 Draft。"""
    from config import get_llm_config
    from agent.agent import _build_llm as build_llm

    topic = get_topic(slug)
    if not topic:
        return None

    qa_entries = topic.get("qa_entries", [])
    if not qa_entries:
        return None

    qa_text = "\n\n---\n\n".join(
        f"Q: {qa['question']}\nA: {(qa.get('answer') or '')[:500]}"
        for qa in qa_entries
    )

    llm = build_llm(get_llm_config())
    prompt = (
        f"你是一个技术文档撰写助手。请根据以下 QA 问答对，总结一份结构化的知识文档。\n\n"
        f"## 主题: {topic['name']}\n"
        f"## 描述: {topic.get('description', '')}\n\n"
        f"## QA 内容\n{qa_text}\n\n"
        f"## 输出格式\n"
        f"请严格按照以下 Markdown 模板输出：\n"
        f"## 概述\n(1-2句话概括这类问题的本质)\n\n"
        f"## 常见场景\n- 场景1\n- 场景2\n\n"
        f"## 解决方案\n(汇总核心解决思路和步骤)\n\n"
        f"## 注意事项\n- 注意点1\n- 注意点2\n\n"
        f"只输出按模板组织的 Markdown 文档，不要其他内容。"
    )

    try:
        resp = llm.invoke(prompt)
        raw_content = resp.content.strip()
    except Exception:
        return None

    save_draft(slug, raw_content)
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET generated_at = ? WHERE topic_slug = ?",
        (now, slug),
    )
    db.commit()

    return get_draft(slug)


def submit_draft(slug: str) -> bool:
    """将 draft 提交到审核队列 (pending → submitted)。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status FROM topic_drafts WHERE topic_slug = ?", (slug,)
    ).fetchone()
    if not row or row["status"] != "pending":
        return False
    db.execute(
        "UPDATE topic_drafts SET status = 'submitted', updated_at = ? WHERE topic_slug = ?",
        (datetime.now(timezone.utc).isoformat(), slug),
    )
    db.commit()
    return True


def reject_draft(slug: str, reason: str) -> bool:
    """审核驳回：submitted → pending，附带驳回理由。"""
    db = get_knowledge_db()
    row = db.execute(
        "SELECT status FROM topic_drafts WHERE topic_slug = ?", (slug,)
    ).fetchone()
    if not row or row["status"] != "submitted":
        return False
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topic_drafts SET status = 'pending', reject_reason = ?, updated_at = ? WHERE topic_slug = ?",
        (reason, now, slug),
    )
    db.commit()
    return True


def get_review_queue() -> list[dict]:
    """获取所有 status='submitted' 的 draft + 关联 topic 信息。"""
    db = get_knowledge_db()
    rows = db.execute(
        """SELECT d.topic_slug, d.raw_content, d.edited_content, d.status,
                  d.created_at, d.updated_at, d.generated_at,
                  t.name as topic_name, t.description as topic_description
           FROM topic_drafts d
           JOIN topics t ON t.slug = d.topic_slug
           WHERE d.status = 'submitted'
           ORDER BY d.updated_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]
