import json
import uuid
from backend.database import get_knora_db


def create_task(type: str, kb_id: str | None = None, repo_id: str | None = None,
                params: dict | None = None) -> dict:
    db = get_knora_db()
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    params_json = json.dumps(params or {})
    db.execute(
        "INSERT INTO tasks (id, type, kb_id, repo_id, params) VALUES (?, ?, ?, ?, ?)",
        (task_id, type, kb_id, repo_id, params_json),
    )
    db.commit()
    return {"id": task_id, "type": type, "status": "pending", "progress": 0,
            "kb_id": kb_id, "repo_id": repo_id, "params": params or {},
            "progress_msg": "", "error_message": None}


def get_task(task_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, type, status, progress, progress_msg, kb_id, repo_id, params, error_message, "
        "created_at, started_at, completed_at FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row[0], "type": row[1], "status": row[2], "progress": row[3],
        "progress_msg": row[4], "kb_id": row[5], "repo_id": row[6],
        "params": json.loads(row[7]) if row[7] else {}, "error_message": row[8],
        "created_at": row[9], "started_at": row[10], "completed_at": row[11],
    }


def list_tasks(status: str | None = None, type: str | None = None, limit: int = 50) -> list[dict]:
    db = get_knora_db()
    conditions = []
    params_list = []
    if status:
        conditions.append("status = ?")
        params_list.append(status)
    if type:
        conditions.append("type = ?")
        params_list.append(type)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = db.execute(
        f"SELECT id, type, status, progress, progress_msg, kb_id, repo_id, params, error_message, "
        f"created_at, started_at, completed_at FROM tasks {where} ORDER BY created_at DESC LIMIT ?",
        (*params_list, limit),
    ).fetchall()
    return [{
        "id": r[0], "type": r[1], "status": r[2], "progress": r[3],
        "progress_msg": r[4], "kb_id": r[5], "repo_id": r[6],
        "params": json.loads(r[7]) if r[7] else {}, "error_message": r[8],
        "created_at": r[9], "started_at": r[10], "completed_at": r[11],
    } for r in rows]


def update_task_status(task_id: str, status: str, progress: int | None = None,
                       progress_msg: str | None = None, error_message: str | None = None,
                       params: dict | None = None) -> None:
    db = get_knora_db()
    sets = ["status = ?"]
    params_list = [status]
    if progress is not None:
        sets.append("progress = ?")
        params_list.append(progress)
    if progress_msg is not None:
        sets.append("progress_msg = ?")
        params_list.append(progress_msg)
    if error_message is not None:
        sets.append("error_message = ?")
        params_list.append(error_message)
    if params is not None:
        # Merge with existing params to preserve fields like kb_id
        current_row = db.execute("SELECT params FROM tasks WHERE id = ?", (task_id,)).fetchone()
        merged = json.loads(current_row[0]) if current_row and current_row[0] else {}
        merged.update(params)
        sets.append("params = ?")
        params_list.append(json.dumps(merged))
    if status in ("completed", "failed", "cancelled"):
        sets.append("completed_at = datetime('now')")
    if status == "running":
        sets.append("started_at = datetime('now')")
    params_list.append(task_id)
    db.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", params_list)
    db.commit()


def cancel_task(task_id: str) -> None:
    update_task_status(task_id, "cancelled", progress_msg="User cancelled")


def claim_next_pending() -> dict | None:
    """Atomically claim the oldest pending task and mark it running."""
    db = get_knora_db()
    row = db.execute(
        "SELECT id, type, kb_id, repo_id, params, progress, progress_msg "
        "FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    db.execute(
        "UPDATE tasks SET status = 'running', started_at = datetime('now') WHERE id = ?",
        (row[0],),
    )
    db.commit()
    return {
        "id": row[0], "type": row[1], "kb_id": row[2], "repo_id": row[3],
        "params": json.loads(row[4]) if row[4] else {},
        "progress": row[5], "progress_msg": row[6],
    }
