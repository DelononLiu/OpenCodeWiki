import uuid
from backend.database import get_knora_db

_ITEM_COLS = "id, kb_id, title, content_md, form, scope, status, owner_id, created_at, updated_at, published_at"


def create_item(owner_id: str, title: str = "", content_md: str = "",
                form: str = "card", scope: str = "personal", status: str | None = None,
                kb_id: str = "") -> dict:
    if form not in ("card", "article"):
        raise ValueError("form 必须是 card 或 article")
    if scope not in ("personal", "team"):
        raise ValueError("scope 必须是 personal 或 team")
    if status is None:
        status = "published" if scope == "team" else "draft"
    db = get_knora_db()
    item_id = f"it-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_items (id, kb_id, title, content_md, form, scope, status, owner_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (item_id, kb_id or "", title or "", content_md or "", form, scope, status, owner_id),
    )
    db.commit()
    return get_item(item_id)


def get_item(item_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(f"SELECT {_ITEM_COLS} FROM knowledge_items WHERE id = ?", (item_id,)).fetchone()
    return _row_to_dict(row) if row else None


def list_items(viewer_id: str, scope: str | None = None, form: str | None = None,
               status: str | None = None, q: str | None = None) -> list[dict]:
    db = get_knora_db()
    sql = (f"SELECT {_ITEM_COLS} FROM knowledge_items "
           "WHERE (scope = 'team' OR (scope = 'personal' AND owner_id = ?))")
    params: list = [viewer_id]
    if scope:
        sql += " AND scope = ?"
        params.append(scope)
    if form:
        sql += " AND form = ?"
        params.append(form)
    if status:
        sql += " AND status = ?"
        params.append(status)
    if q:
        sql += " AND (title LIKE ? OR content_md LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like])
    sql += " ORDER BY created_at DESC"
    rows = db.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_item(item_id: str, title: str | None = None, content_md: str | None = None) -> dict | None:
    db = get_knora_db()
    sets, params = [], []
    if title is not None:
        sets.append("title = ?")
        params.append(title)
    if content_md is not None:
        sets.append("content_md = ?")
        params.append(content_md)
    if not sets:
        return get_item(item_id)
    sets.append("updated_at = datetime('now')")
    params.append(item_id)
    db.execute(f"UPDATE knowledge_items SET {', '.join(sets)} WHERE id = ?", params)
    db.commit()
    return get_item(item_id)


def publish_card(item_id: str) -> dict:
    item = get_item(item_id)
    if not item:
        raise ValueError("知识项不存在")
    if item["form"] != "card":
        raise ValueError("只有卡片可以直接发布，文章请走提交审核")
    if item["scope"] == "team":
        return item
    return _set_scope_and_status(item_id, "team", "published", publish=True)


def submit_item(item_id: str) -> dict:
    item = get_item(item_id)
    if not item:
        raise ValueError("知识项不存在")
    if item["form"] != "article":
        raise ValueError("只有文章需要提交审核")
    db = get_knora_db()
    db.execute("UPDATE knowledge_items SET status = 'pending' WHERE id = ?", (item_id,))
    db.commit()
    return get_item(item_id)


def approve_item(item_id: str) -> dict:
    return _set_scope_and_status(item_id, "team", "published", publish=True)


def reject_item(item_id: str) -> dict:
    return _set_scope_and_status(item_id, "personal", "draft", publish=False)


def _set_scope_and_status(item_id: str, scope: str, status: str, publish: bool) -> dict:
    db = get_knora_db()
    if publish:
        db.execute(
            "UPDATE knowledge_items SET scope = ?, status = ?, published_at = datetime('now') WHERE id = ?",
            (scope, status, item_id),
        )
    else:
        db.execute(
            "UPDATE knowledge_items SET scope = ?, status = ? WHERE id = ?",
            (scope, status, item_id),
        )
    db.commit()
    return get_item(item_id)


def delete_item(item_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM knowledge_items WHERE id = ?", (item_id,))
    db.commit()


def add_link(source_id: str, target_id: str, link_type: str) -> None:
    db = get_knora_db()
    db.execute(
        "INSERT OR IGNORE INTO item_links (source_id, target_id, type) VALUES (?, ?, ?)",
        (source_id, target_id, link_type),
    )
    db.commit()


def list_links(item_id: str) -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        """SELECT k.id, k.title, k.form, l.type, l.source_id
           FROM item_links l JOIN knowledge_items k ON k.id = CASE
               WHEN l.source_id = ? THEN l.target_id ELSE l.source_id END
           WHERE l.source_id = ? OR l.target_id = ?""",
        (item_id, item_id, item_id),
    ).fetchall()
    return [{"id": r[0], "title": r[1], "form": r[2], "type": r[3],
             "direction": "out" if r[4] == item_id else "in"} for r in rows]


def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "kb_id": row[1], "title": row[2], "content_md": row[3],
        "form": row[4], "scope": row[5], "status": row[6],
        "owner_id": row[7], "created_at": row[8],
        "updated_at": row[9], "published_at": row[10],
    }
