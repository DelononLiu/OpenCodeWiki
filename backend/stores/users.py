import uuid
from backend.database import get_knora_db
from backend.auth import hash_password

_USER_COLS = "id, username, password_hash, role, active, created_at"


def create_user(username: str, password: str) -> dict:
    db = get_knora_db()
    name = (username or "").strip()
    if not name:
        raise ValueError("用户名不能为空")
    if db.execute("SELECT id FROM users WHERE username = ?", (name,)).fetchone():
        raise ValueError("用户名已存在")
    uid = f"usr-{uuid.uuid4().hex[:8]}"
    is_first = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    role = "admin" if is_first else "user"
    db.execute(
        "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        (uid, name, hash_password(password), role),
    )
    db.commit()
    return {"id": uid, "username": name, "role": role, "active": True}


def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "username": row[1],
        "password_hash": None,
        "role": row[3], "active": bool(row[4]), "created_at": row[5],
    }


def get_user(user_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(f"SELECT {_USER_COLS} FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_dict(row) if row else None


def get_user_by_username(username: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(f"SELECT {_USER_COLS} FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    d["password_hash"] = row[2]
    return d


def list_users() -> list[dict]:
    db = get_knora_db()
    rows = db.execute(f"SELECT {_USER_COLS} FROM users ORDER BY created_at").fetchall()
    return [_row_to_dict(r) for r in rows]


def set_user_active(user_id: str, active: bool) -> None:
    db = get_knora_db()
    db.execute("UPDATE users SET active = ? WHERE id = ?", (1 if active else 0, user_id))
    db.commit()
