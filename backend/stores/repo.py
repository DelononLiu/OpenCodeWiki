import uuid
from backend.database import get_knora_db


def create_repo(type: str, url: str, branch: str, local_path: str, kb_id: str,
                schedule: str = "") -> dict:
    db = get_knora_db()
    repo_id = f"repo-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO remote_repos (id, type, url, branch, local_path, kb_id, schedule) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (repo_id, type, url, branch, local_path, kb_id, schedule),
    )
    db.commit()
    return {"id": repo_id, "type": type, "url": url, "branch": branch,
            "local_path": local_path, "kb_id": kb_id, "schedule": schedule,
            "last_sync_at": None, "last_status": "pending"}


def get_repo(repo_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(
        "SELECT id, type, url, branch, local_path, kb_id, schedule, last_sync_at, last_status, created_at "
        "FROM remote_repos WHERE id = ?", (repo_id,)
    ).fetchone()
    if not row:
        return None
    return {"id": row[0], "type": row[1], "url": row[2], "branch": row[3],
            "local_path": row[4], "kb_id": row[5], "schedule": row[6],
            "last_sync_at": row[7], "last_status": row[8], "created_at": row[9]}


def list_repos(kb_id: str | None = None) -> list[dict]:
    db = get_knora_db()
    if kb_id:
        rows = db.execute(
            "SELECT id, type, url, branch, local_path, kb_id, schedule, last_sync_at, last_status, created_at "
            "FROM remote_repos WHERE kb_id = ? ORDER BY created_at DESC", (kb_id,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, type, url, branch, local_path, kb_id, schedule, last_sync_at, last_status, created_at "
            "FROM remote_repos ORDER BY created_at DESC"
        ).fetchall()
    return [{"id": r[0], "type": r[1], "url": r[2], "branch": r[3],
             "local_path": r[4], "kb_id": r[5], "schedule": r[6],
             "last_sync_at": r[7], "last_status": r[8], "created_at": r[9]} for r in rows]


def update_repo(repo_id: str, **kwargs) -> None:
    db = get_knora_db()
    allowed = {"url", "branch", "local_path", "kb_id", "schedule", "last_sync_at", "last_status"}
    sets = []
    params = []
    for k, v in kwargs.items():
        if k in allowed:
            sets.append(f"{k} = ?")
            params.append(v)
    if not sets:
        return
    params.append(repo_id)
    db.execute(f"UPDATE remote_repos SET {', '.join(sets)} WHERE id = ?", params)
    db.commit()


def delete_repo(repo_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM remote_repos WHERE id = ?", (repo_id,))
    db.commit()


def update_sync_status(repo_id: str, status: str) -> None:
    db = get_knora_db()
    db.execute(
        "UPDATE remote_repos SET last_status = ?, last_sync_at = datetime('now') WHERE id = ?",
        (status, repo_id),
    )
    db.commit()
