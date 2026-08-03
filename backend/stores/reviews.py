import uuid
from backend.database import get_knora_db
from backend.stores.items import approve_item, reject_item

_TASK_COLS = "id, item_id, reviewer_id, action, reason, created_at, reviewed_at"


def create_review_task(item_id: str) -> dict:
    db = get_knora_db()
    existing = db.execute("SELECT id FROM review_tasks WHERE item_id = ?", (item_id,)).fetchone()
    if existing:
        return get_review_task(item_id)
    task_id = f"rev-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO review_tasks (id, item_id) VALUES (?, ?)", (task_id, item_id)
    )
    db.commit()
    return get_review_task(item_id)


def get_review_task(item_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(f"SELECT {_TASK_COLS} FROM review_tasks WHERE item_id = ?", (item_id,)).fetchone()
    return _row_to_dict(row) if row else None


def list_review_tasks(status: str = "pending") -> list[dict]:
    db = get_knora_db()
    rows = db.execute(
        f"""SELECT review_tasks.id, review_tasks.item_id, review_tasks.reviewer_id,
                   review_tasks.action, review_tasks.reason, review_tasks.created_at,
                   review_tasks.reviewed_at, k.title, k.owner_id
            FROM review_tasks JOIN knowledge_items k ON k.id = review_tasks.item_id
            WHERE review_tasks.action = ?
            ORDER BY review_tasks.created_at""",
        (status,),
    ).fetchall()
    return [{
        "id": r[0], "item_id": r[1], "reviewer_id": r[2], "action": r[3],
        "reason": r[4], "created_at": r[5], "reviewed_at": r[6],
        "title": r[7], "owner_id": r[8],
    } for r in rows]


def approve_review(item_id: str, reviewer_id: str, reason: str = "") -> dict:
    approve_item(item_id)
    return _finish_task(item_id, reviewer_id, "approved", reason)


def reject_review(item_id: str, reviewer_id: str, reason: str) -> dict:
    reject_item(item_id)
    return _finish_task(item_id, reviewer_id, "rejected", reason)


def _finish_task(item_id: str, reviewer_id: str, action: str, reason: str) -> dict:
    db = get_knora_db()
    db.execute(
        "UPDATE review_tasks SET action = ?, reviewer_id = ?, reason = ?, reviewed_at = datetime('now') "
        "WHERE item_id = ?",
        (action, reviewer_id, reason, item_id),
    )
    db.commit()
    return get_review_task(item_id)


def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "item_id": row[1], "reviewer_id": row[2],
        "action": row[3], "reason": row[4], "created_at": row[5], "reviewed_at": row[6],
    }
