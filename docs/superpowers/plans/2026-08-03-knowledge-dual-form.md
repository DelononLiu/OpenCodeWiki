# 知识库双形态（第一期：核心闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCodeWiki 上实现"3 输入 × 2 输出"知识闭环的第一期：用户体系 + 知识项单域模型（卡片/文章）+ 碎片捕获 + 沉淀动作 + 审核台 + RAG 团队层过滤。

**Architecture:** 统一知识项模型。`knowledge_items`（form × scope × status 三维）为唯一输出实体；QA 记录= sessions+messages（加 owner_id 个人化）；碎片=个人卡片；沉淀=原料→知识项转化（AI 提炼/起草）；文章审核通过瞬间 = 个人→团队边界；向量检索只命中 `scope=team AND status=published` 的知识项。

**Tech Stack:** Python 3.11+ / FastAPI / sqlite3（WAL）/ sqlite-vec + FTS5 / React 18 + Vite / Vitest + Testing Library / httpx AsyncClient 测试。

**Spec:** `docs/superpowers/specs/2026-08-03-knowledge-dual-form-design.md`

## Global Constraints

- 密码哈希用标准库 `hashlib.pbkdf2_hmac`（spec 写 bcrypt，实现用 stdlib 避免新增原生依赖；同为加盐哈希，`hmac.compare_digest` 防时序攻击）。
- 会话令牌：HMAC-SHA256 签名 token，`Authorization: Bearer <token>` 头传递。
- **不新增任何 pip / npm 依赖。**
- 后端测试惯例：`tempfile.mkdtemp()` + `Config()` 改 `database.path` + `init_databases(cfg)`；API 测试用 `httpx.AsyncClient(transport=ASGITransport(app=create_app(cfg)))`，`@pytest.mark.asyncio`。
- 前端测试惯例：vi.mock 依赖 + `MemoryRouter` + Testing Library（参照 `frontend/src/pages/QAPage.test.tsx`）。
- 前端当前 API 客户端是 `frontend/src/api/opencodewiki.ts`（新），`frontend/src/api/client.ts` 是遗留代码——新功能只改 opencodewiki.ts。
- 旧数据兼容：已存在 sessions 的 `owner_id` 为空串，视为对登录用户可见的遗留数据（admin 可见全部）。
- 提交信息：`feat:`/`fix:`/`docs:` + 中文描述，结尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 所有 `/api/*` 路由除白名单（`/api/auth/register`、`/api/auth/login`、`/api/config`）外都需要登录。

---

## 文件结构

**新增（后端）**
- `backend/stores/users.py` — 用户 CRUD（首个用户自动 admin）
- `backend/auth.py` — 密码哈希、token、签名密钥
- `backend/stores/items.py` — knowledge_items CRUD + publish/submit + 链接
- `backend/stores/reviews.py` — 审核队列
- `backend/sediment.py` — AI 提炼卡片 / AI 起草文章（LLM 调用）
- `backend/knowledge/item_index.py` — 知识项向量索引

**修改（后端）**
- `backend/database.py` — 新表 users/knowledge_items/item_links/review_tasks/item_derivations + sessions.owner_id 迁移
- `backend/main.py` — 鉴权中间件 + 12 个新路由 + sessions 个人化
- `backend/knowledge/vector_store.py` — item_vec0/item_fts 搜索
- `backend/pipeline/plugins/search.py` — 合并知识项结果

**新增（前端）**
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/pages/LoginPage.tsx`、`RegisterPage.tsx`
- `frontend/src/pages/FragmentsPage.tsx`、`CardsPage.tsx`
- `frontend/src/components/qa/SedimentMenu.tsx`
- `frontend/src/components/review/ReviewPanel.tsx`

**修改（前端）**
- `frontend/src/api/opencodewiki.ts` — auth 头 + 新 API
- `frontend/src/types/opencodewiki.ts` — User/KnowledgeItem/ReviewTask
- `frontend/src/App.tsx` — 路由 + 守卫
- `frontend/src/components/layout/AppSidebar.tsx` — 导航 6 项 + 登录态用户块
- `frontend/src/pages/QAPage.tsx`、`frontend/src/pages/AdminPage.tsx`

**测试**
- `backend/tests/test_auth.py`（哈希/token/用户存储）、`test_items.py`、`test_reviews.py`、`test_item_index.py`
- `backend/tests/test_api.py` 扩展（认证/碎片/卡片/沉淀/审核）
- `frontend/src/pages/LoginPage.test.tsx`、`FragmentsPage.test.tsx`、`CardsPage.test.tsx`

---

### Task 1: 密码哈希与用户存储

**Files:**
- Create: `backend/auth.py`
- Create: `backend/stores/users.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Produces:
  - `auth.hash_password(password: str) -> str`
  - `auth.verify_password(password: str, stored: str) -> bool`
  - `auth.get_secret(cfg: Config) -> str`（env `SECRET_KEY` 优先，否则 `~/.opencodewiki/.session_secret` 生成持久化）
  - `auth.create_token(user_id: str, secret: str, ttl_hours: int = 168) -> str`
  - `auth.verify_token(token: str, secret: str) -> str | None`
  - `stores.users.create_user(username, password) -> dict`（含 `role`；首个用户 role="admin"）
  - `stores.users.get_user(user_id) -> dict | None`（不含 password_hash）
  - `stores.users.get_user_by_username(username) -> dict | None`（含 password_hash，登录用）
  - `stores.users.list_users() -> list[dict]`
  - `stores.users.set_user_active(user_id, active: bool) -> None`

- [ ] **Step 1: 写失败的测试** `backend/tests/test_auth.py`

```python
import tempfile
from backend.database import init_databases
from backend.config import Config
from backend.auth import hash_password, verify_password, create_token, verify_token, get_secret
from backend.stores.users import create_user, get_user, get_user_by_username, list_users, set_user_active


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def test_hash_and_verify_password():
    stored = hash_password("secret123")
    assert stored.startswith("pbkdf2_sha256$")
    assert verify_password("secret123", stored)
    assert not verify_password("wrong", stored)

def test_password_hashes_are_salted():
    assert hash_password("same") != hash_password("same")

def test_token_roundtrip():
    secret = "test-secret"
    token = create_token("usr-1", secret)
    assert verify_token(token, secret) == "usr-1"
    assert verify_token(token, "other-secret") is None
    assert verify_token("garbage", secret) is None

def test_get_secret_persists(tmp_path):
    cfg = Config()
    cfg.database.path = str(tmp_path)
    s1 = get_secret(cfg)
    s2 = get_secret(cfg)
    assert s1 == s2 and len(s1) >= 32

def test_first_user_is_admin():
    admin = create_user("alice", "pw1")
    assert admin["role"] == "admin"
    user = create_user("bob", "pw2")
    assert user["role"] == "user"

def test_duplicate_username_rejected():
    create_user("carol", "pw3")
    try:
        create_user("carol", "pw4")
        assert False, "should raise"
    except ValueError:
        pass

def test_get_user_and_list():
    u = create_user("dave", "pw5")
    assert get_user(u["id"])["username"] == "dave"
    assert get_user(u["id"])["password_hash"] is None  # 不泄漏哈希
    assert any(x["username"] == "dave" for x in list_users())

def test_login_lookup_includes_hash():
    u = create_user("eve", "pw6")
    found = get_user_by_username("eve")
    assert found["password_hash"] and found["password_hash"].startswith("pbkdf2_sha256$")

def test_deactivate_user():
    u = create_user("frank", "pw7")
    set_user_active(u["id"], False)
    assert get_user(u["id"])["active"] is False
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_auth.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'backend.auth'` / `no such table: users`）

- [ ] **Step 3: 实现 `backend/auth.py`**

```python
"""密码哈希与会话令牌（仅标准库）。"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

_ITERATIONS = 200_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != _ALGO:
            return False
        salt = base64.b64decode(salt_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except Exception:
        return False


def get_secret(cfg) -> str:
    """会话签名密钥：env SECRET_KEY 优先，否则在数据目录持久化随机密钥。"""
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    key_path = os.path.join(os.path.expanduser(cfg.database.path), ".session_secret")
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    os.makedirs(os.path.dirname(key_path), exist_ok=True)
    secret = secrets.token_hex(32)
    with open(key_path, "w") as f:
        f.write(secret)
    return secret


def create_token(user_id: str, secret: str, ttl_hours: int = 168) -> str:
    payload = {"uid": user_id, "exp": time.time() + ttl_hours * 3600}
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_token(token: str, secret: str) -> str | None:
    try:
        payload_b64, sig = token.split(".")
        expected = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        if payload["exp"] < time.time():
            return None
        return payload["uid"]
    except Exception:
        return None
```

- [ ] **Step 4: 实现 `backend/stores/users.py`**

```python
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
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_auth.py -v`
Expected: PASS（15 passed）—— 此时会因 users 表不存在而失败，**先执行 Task 2 再回来跑**；若 Task 1 单独执行，可临时跳过 database 相关测试，按顺序执行即可。

- [ ] **Step 6: 提交**

```bash
git add backend/auth.py backend/stores/users.py backend/tests/test_auth.py
git commit -m "feat: 密码哈希与用户存储（首个用户自动管理员）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 数据库 schema 扩展

**Files:**
- Modify: `backend/database.py`（KNORA_SCHEMA 追加 5 张表；_MIGRATIONS 加 owner_id）
- Test: `backend/tests/test_database.py` 追加

**Interfaces:**
- Produces: 新表 `users`, `knowledge_items`, `item_links`, `review_tasks`, `item_derivations`；`sessions.owner_id` 列（默认 `''`）。`init_databases(cfg)` 幂等可重跑。

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_database.py` 末尾）

```python
def test_new_tables_exist():
    from backend.database import get_knora_db
    db = get_knora_db()
    for table in ("users", "knowledge_items", "item_links", "review_tasks", "item_derivations"):
        row = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        assert row is not None, f"table {table} missing"

def test_sessions_have_owner_column():
    from backend.database import get_knora_db
    db = get_knora_db()
    cols = [r[1] for r in db.execute("PRAGMA table_info(sessions)").fetchall()]
    assert "owner_id" in cols

def test_knowledge_items_check_constraints():
    from backend.database import get_knora_db
    db = get_knora_db()
    db.execute(
        "INSERT INTO users (id, username, password_hash, role) VALUES ('usr-t1', 't1', 'h', 'user')"
    )
    db.commit()
    try:
        db.execute(
            "INSERT INTO knowledge_items (id, title, content_md, form, scope, status, owner_id) "
            "VALUES ('it-t1', 'x', 'y', 'bad-form', 'personal', 'draft', 'usr-t1')"
        )
        db.commit()
        assert False, "bad form should violate CHECK"
    except Exception:
        pass
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_database.py -v`
Expected: FAIL（`table users missing`）

- [ ] **Step 3: 修改 `backend/database.py`**

在 `KNORA_SCHEMA`（`tasks` 表之后、结尾 `"""` 之前）追加：

```sql
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_items (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT '',
    content_md    TEXT NOT NULL DEFAULT '',
    form          TEXT NOT NULL CHECK(form IN ('card','article')),
    scope         TEXT NOT NULL CHECK(scope IN ('personal','team')),
    status        TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','published')),
    owner_id      TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    published_at  TEXT
);

CREATE TABLE IF NOT EXISTS item_links (
    source_id     TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    target_id     TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK(type IN ('references','derived_from')),
    created_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, target_id, type)
);

CREATE TABLE IF NOT EXISTS review_tasks (
    id            TEXT PRIMARY KEY,
    item_id       TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    reviewer_id   TEXT,
    action        TEXT NOT NULL DEFAULT 'pending' CHECK(action IN ('pending','approved','rejected')),
    reason        TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now')),
    reviewed_at   TEXT
);

CREATE TABLE IF NOT EXISTS item_derivations (
    item_id       TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    source_type   TEXT NOT NULL,
    source_ref    TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, source_type, source_ref)
);
```

在 `_MIGRATIONS` 列表末尾追加：

```python
    "ALTER TABLE sessions ADD COLUMN owner_id TEXT DEFAULT ''",
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_database.py tests/test_auth.py -v`
Expected: PASS（两组全过）

- [ ] **Step 5: 提交**

```bash
git add backend/database.py backend/tests/test_database.py
git commit -m "feat: 数据库新增 users/knowledge_items/item_links/review_tasks/item_derivations 表

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 知识项存储（stores/items.py）

**Files:**
- Create: `backend/stores/items.py`
- Test: `backend/tests/test_items.py`

**Interfaces:**
- Consumes: `get_knora_db()`
- Produces:
  - `create_item(owner_id, title="", content_md="", form="card", scope="personal", status=None) -> dict`
    - status 缺省规则：scope=team → `"published"`；否则 `"draft"`
  - `get_item(item_id) -> dict | None`
  - `list_items(viewer_id, scope=None, form=None, status=None, q=None) -> list[dict]`
    - 可见性：`(scope='team') OR (scope='personal' AND owner_id=viewer)`
  - `update_item(item_id, title=None, content_md=None) -> dict | None`（updated_at 刷新）
  - `publish_card(item_id) -> dict`：card 且 scope=personal → scope=team, status=published, published_at=now；**article 抛 ValueError**
  - `submit_item(item_id) -> dict`：status → pending（建 review task 由 Task 4 提供，此函数只改状态）
  - `approve_item(item_id) -> dict`：scope=team, status=published, published_at=now
  - `reject_item(item_id) -> dict`：scope=personal, status=draft
  - `delete_item(item_id) -> None`
  - `add_link(source_id, target_id, link_type) -> None`（INSERT OR IGNORE）
  - `list_links(item_id) -> list[dict]`（backlinks + outlinks，含对方 id/title/form）

- [ ] **Step 1: 写失败的测试** `backend/tests/test_items.py`

```python
import tempfile
from backend.database import init_databases, get_knora_db
from backend.config import Config
from backend.stores.users import create_user
from backend.stores.items import (
    create_item, get_item, list_items, update_item, publish_card,
    submit_item, approve_item, reject_item, delete_item, add_link, list_links,
)


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def _users():
    a = create_user("alice", "pw")["id"]
    b = create_user("bob", "pw")["id"]
    return a, b

def test_create_and_get_item():
    owner, _ = _users()
    item = create_item(owner, "卡片一", "内容", form="card", scope="personal")
    assert item["status"] == "draft"
    got = get_item(item["id"])
    assert got["title"] == "卡片一" and got["owner_id"] == owner

def test_team_card_auto_published():
    owner, _ = _users()
    item = create_item(owner, "直接新增", "内容", form="card", scope="team")
    assert item["status"] == "published"

def test_visibility():
    alice, bob = _users()
    a_private = create_item(alice, "a私有", "x", scope="personal")
    team_card = create_item(alice, "团队卡", "y", form="card", scope="team")
    # alice 可见自己的私有 + 团队
    ids_a = {i["id"] for i in list_items(alice)}
    assert a_private["id"] in ids_a and team_card["id"] in ids_a
    # bob 看不到 alice 的私有
    ids_b = {i["id"] for i in list_items(bob)}
    assert a_private["id"] not in ids_b and team_card["id"] in ids_b

def test_filter_by_form_scope():
    owner, _ = _users()
    c = create_item(owner, "卡", "x", form="card", scope="team")
    a = create_item(owner, "文", "y", form="article", scope="team")
    assert [i["id"] for i in list_items(owner, form="card")] == [c["id"]]
    assert [i["id"] for i in list_items(owner, form="article")] == [a["id"]]

def test_keyword_search():
    owner, _ = _users()
    create_item(owner, "Kubernetes 部署指南", "内容", scope="team")
    hits = list_items(owner, q="kubernetes")
    assert len(hits) == 1

def test_update_item():
    owner, _ = _users()
    item = create_item(owner, "旧标题", "旧内容")
    updated = update_item(item["id"], title="新标题")
    assert updated["title"] == "新标题"
    assert updated["content_md"] == "旧内容"

def test_publish_card_to_team():
    owner, _ = _users()
    item = create_item(owner, "碎片", "内容")
    published = publish_card(item["id"])
    assert published["scope"] == "team" and published["status"] == "published"
    assert published["published_at"]

def test_publish_article_rejected():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    try:
        publish_card(art["id"])
        assert False, "article cannot publish directly"
    except ValueError:
        pass

def test_article_review_lifecycle():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    assert submit_item(art["id"])["status"] == "pending"
    assert approve_item(art["id"])["status"] == "published"
    assert get_item(art["id"])["scope"] == "team"

def test_reject_returns_to_draft():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    submit_item(art["id"])
    assert reject_item(art["id"])["status"] == "draft"
    assert get_item(art["id"])["scope"] == "personal"

def test_delete_item():
    owner, _ = _users()
    item = create_item(owner, "要删", "x")
    delete_item(item["id"])
    assert get_item(item["id"]) is None

def test_links():
    owner, _ = _users()
    a = create_item(owner, "卡A", "x", scope="team")
    b = create_item(owner, "卡B", "y", scope="team")
    add_link(a["id"], b["id"], "references")
    links = list_links(a["id"])
    assert any(l["id"] == b["id"] for l in links)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_items.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'backend.stores.items'`）

- [ ] **Step 3: 实现 `backend/stores/items.py`**

```python
import uuid
from backend.database import get_knora_db

_ITEM_COLS = "id, title, content_md, form, scope, status, owner_id, created_at, updated_at, published_at"


def create_item(owner_id: str, title: str = "", content_md: str = "",
                form: str = "card", scope: str = "personal", status: str | None = None) -> dict:
    if form not in ("card", "article"):
        raise ValueError("form 必须是 card 或 article")
    if scope not in ("personal", "team"):
        raise ValueError("scope 必须是 personal 或 team")
    if status is None:
        status = "published" if scope == "team" else "draft"
    db = get_knora_db()
    item_id = f"it-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_items (id, title, content_md, form, scope, status, owner_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (item_id, title or "", content_md or "", form, scope, status, owner_id),
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
        "id": row[0], "title": row[1], "content_md": row[2],
        "form": row[3], "scope": row[4], "status": row[5],
        "owner_id": row[6], "created_at": row[7],
        "updated_at": row[8], "published_at": row[9],
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_items.py -v`
Expected: PASS（13 passed）

- [ ] **Step 5: 提交**

```bash
git add backend/stores/items.py backend/tests/test_items.py
git commit -m "feat: 知识项存储（卡片/文章 CRUD、发布、提交、审核状态流转、引用链接）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 审核队列存储（stores/reviews.py）

**Files:**
- Create: `backend/stores/reviews.py`
- Test: `backend/tests/test_reviews.py`

**Interfaces:**
- Consumes: `stores.items.get_item`, `approve_item`, `reject_item`
- Produces:
  - `create_review_task(item_id) -> dict`
  - `list_review_tasks(status="pending") -> list[dict]`（join 文章标题）
  - `approve_review(item_id, reviewer_id, reason="") -> dict`（任务 action=approved + item approve；返回任务）
  - `reject_review(item_id, reviewer_id, reason) -> dict`（任务 action=rejected + item reject）

- [ ] **Step 1: 写失败的测试** `backend/tests/test_reviews.py`

```python
import tempfile
from backend.database import init_databases
from backend.config import Config
from backend.stores.users import create_user
from backend.stores.items import create_item, submit_item
from backend.stores.reviews import (
    create_review_task, list_review_tasks, approve_review, reject_review, get_review_task,
)


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def _article_owner():
    owner = create_user("alice", "pw")["id"]
    art = create_item(owner, "待审文章", "内容", form="article")
    submit_item(art["id"])
    return owner, art

def test_create_and_list_review_task():
    owner, art = _article_owner()
    task = create_review_task(art["id"])
    assert task["action"] == "pending"
    tasks = list_review_tasks()
    assert any(t["item_id"] == art["id"] for t in tasks)
    assert any(t["title"] == "待审文章" for t in tasks)

def test_approve_review_publishes_item():
    owner, art = _article_owner()
    create_review_task(art["id"])
    reviewer = create_user("adminx", "pw")["id"]
    task = approve_review(art["id"], reviewer, "内容准确")
    assert task["action"] == "approved"
    from backend.stores.items import get_item
    item = get_item(art["id"])
    assert item["status"] == "published" and item["scope"] == "team"

def test_reject_review_returns_to_draft():
    owner, art = _article_owner()
    create_review_task(art["id"])
    reviewer = create_user("adminy", "pw")["id"]
    task = reject_review(art["id"], reviewer, "需要补充引用")
    assert task["action"] == "rejected" and task["reason"] == "需要补充引用"
    from backend.stores.items import get_item
    assert get_item(art["id"])["status"] == "draft"

def test_get_review_task():
    owner, art = _article_owner()
    create_review_task(art["id"])
    assert get_review_task(art["id"]) is not None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_reviews.py -v`
Expected: FAIL（`No module named 'backend.stores.reviews'`）

- [ ] **Step 3: 实现 `backend/stores/reviews.py`**

```python
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
        f"""SELECT {_TASK_COLS}, k.title, k.owner_id
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_reviews.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add backend/stores/reviews.py backend/tests/test_reviews.py
git commit -m "feat: 审核队列存储（待审列表、批准/驳回并联动知识项状态）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 认证 API + 鉴权中间件

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api.py` 追加

**Interfaces:**
- Consumes: `auth.get_secret`, `auth.create_token`, `auth.verify_token`, `stores.users.*`
- Produces:
  - `POST /api/auth/register {username, password}` → `{token, user}`（首个用户 role=admin）
  - `POST /api/auth/login {username, password}` → `{token, user}`；错误 401
  - `GET /api/auth/me` → `user`（需登录）
  - HTTP 中间件：`/api/*` 除 `{/api/auth/register, /api/auth/login, /api/config}` 外必须带有效 Bearer token，否则 401 `{"detail":"未登录"}`；成功后 `request.state.user = user`
  - 依赖函数（main.py 内定义）：
    - `def get_current_user(request: Request) -> dict`（读 request.state.user，缺失 401）
    - `def require_admin(user: dict = Depends(get_current_user)) -> dict`（非 admin 403）

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_api.py` 末尾）

```python
@pytest.mark.asyncio
async def test_auth_register_login_me(client):
    resp = await client.post("/api/auth/register", json={"username": "alice", "password": "pw123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["username"] == "alice"
    assert data["user"]["role"] == "admin"  # 首个用户
    token = data["token"]

    # 未登录访问受保护接口 → 401
    resp = await client.get("/api/kb")
    assert resp.status_code == 401

    # 带 token → 200
    resp = await client.get("/api/kb", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    # me
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"

    # 登录
    resp = await client.post("/api/auth/login", json={"username": "alice", "password": "pw123"})
    assert resp.status_code == 200

    # 错误密码 → 401
    resp = await client.post("/api/auth/login", json={"username": "alice", "password": "bad"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_second_user_is_normal(client):
    await client.post("/api/auth/register", json={"username": "alice", "password": "pw"})
    resp = await client.post("/api/auth/register", json={"username": "bob", "password": "pw"})
    assert resp.json()["user"]["role"] == "user"

@pytest.mark.asyncio
async def test_duplicate_username_register(client):
    await client.post("/api/auth/register", json={"username": "carol", "password": "pw"})
    resp = await client.post("/api/auth/register", json={"username": "carol", "password": "pw"})
    assert resp.status_code == 400
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: FAIL（404，路由不存在）

- [ ] **Step 3: 修改 `backend/main.py`**

3.1 顶部 import 区（第 16 行 `create_message...` 之后）追加：

```python
from backend.auth import get_secret, create_token, verify_token
from backend.stores.users import create_user, get_user, get_user_by_username
```

3.2 在 `create_app` 内、`app = FastAPI(...)` 之后追加鉴权中间件与依赖：

```python
    secret = get_secret(cfg)

    @app.middleware("http")
    async def auth_gate(request: Request, call_next):
        path = request.url.path
        public = ("/api/auth/register", "/api/auth/login", "/api/config")
        if path.startswith("/api") and path not in public:
            auth = request.headers.get("Authorization", "")
            user = None
            if auth.startswith("Bearer "):
                uid = verify_token(auth[7:], secret)
                user = get_user(uid) if uid else None
            if not user or not user["active"]:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "未登录"}, status_code=401)
            request.state.user = user
        return await call_next(request)

    def get_current_user(request: Request) -> dict:
        user = getattr(request.state, "user", None)
        if not user:
            raise HTTPException(401, "未登录")
        return user

    def require_admin(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] != "admin":
            raise HTTPException(403, "需要管理员权限")
        return user
```

3.3 在 `get_config` 路由之后追加认证路由：

```python
    class AuthRequest(BaseModel):
        username: str
        password: str

    @app.post("/api/auth/register")
    async def api_register(req: AuthRequest):
        try:
            user = create_user(req.username, req.password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        token = create_token(user["id"], secret)
        return {"token": token, "user": user}

    @app.post("/api/auth/login")
    async def api_login(req: AuthRequest):
        user = get_user_by_username(req.username)
        from backend.auth import verify_password
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(401, "用户名或密码错误")
        if not user["active"]:
            raise HTTPException(401, "账号已停用")
        return {"token": create_token(user["id"], secret),
                "user": {"id": user["id"], "username": user["username"],
                         "role": user["role"], "active": user["active"]}}

    @app.get("/api/auth/me")
    async def api_me(user: dict = Depends(get_current_user)):
        return user
```

3.4 补 import：顶部 `from fastapi import FastAPI, UploadFile, File, Form, HTTPException` 改为

```python
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Depends
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: PASS（原有用例 + 3 个新用例全过。注意：**原有用例会开始收到 401** —— 若如此，给 test_api.py 的 `client` fixture 里注册用户并注入 Authorization 头，见下方 Step 4b。）

**Step 4b（如原有用例 401 失败）**：修改 `backend/tests/test_api.py` 的 `client` fixture，在 yield 前注册用户并让后续请求默认带头：

```python
@pytest.fixture
async def client():
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    os.makedirs(f"{db_path}/files", exist_ok=True)
    init_databases(cfg)
    app = create_app(cfg)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/auth/register", json={"username": "tester", "password": "pw"})
        token = r.json()["token"]
        ac.headers["Authorization"] = f"Bearer {token}"
        yield ac
    import shutil
    shutil.rmtree(db_path)
```

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_api.py
git commit -m "feat: 认证 API（注册/登录/me）+ 全接口鉴权中间件

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: sessions 个人化（QA 记录归属）

**Files:**
- Modify: `backend/stores/session.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_stores.py` + `backend/tests/test_api.py` 追加

**Interfaces:**
- Consumes: Task 5 的 `get_current_user`
- Produces:
  - `create_session(kb_id, title="", owner_id="") -> dict`
  - `list_sessions(kb_id=None, owner_id=None) -> list[dict]`（owner_id=None 时不过滤，保留给 admin）
  - `get_session(sid)` 不变
  - `/api/sessions`：普通用户只见自己的（`owner_id == uid OR owner_id == ''`）；admin 见全部
  - `/api/sessions` POST：写入 owner_id
  - `/api/sessions/{sid}`：非本人且非 admin 且非遗留 → 403
  - `/api/qa`：创建/复用会话时写入 owner_id，复用校验归属

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_stores.py`：

```python
def test_session_owner_scoping():
    ses1 = create_session("kb1", "s1", owner_id="usr-a")
    ses2 = create_session("kb1", "s2", owner_id="usr-b")
    legacy = create_session("kb1", "legacy")
    ids_a = {s["id"] for s in list_sessions(None, owner_id="usr-a")}
    assert ses1["id"] in ids_a and ses2["id"] not in ids_a and legacy["id"] in ids_a
```

追加到 `backend/tests/test_api.py`：

```python
@pytest.mark.asyncio
async def test_sessions_are_user_scoped(client):
    # 已注册 tester(admin) 并带 token；再造第二个用户
    r = await client.post("/api/auth/register", json={"username": "other", "password": "pw"})
    other_token = r.json()["token"]

    r = await client.post("/api/sessions", json={"kb_id": "", "title": "我的会话"})
    my_sid = r.json()["id"]

    # other 用户看不到我的会话
    resp = await client.get("/api/sessions", headers={"Authorization": f"Bearer {other_token}"})
    assert all(s["id"] != my_sid for s in resp.json())

    # other 用户访问我的会话详情 → 403
    resp = await client.get(f"/api/sessions/{my_sid}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 403

    # admin 可见全部
    resp = await client.get("/api/sessions")
    assert any(s["id"] == my_sid for s in resp.json())
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_stores.py tests/test_api.py -v`
Expected: FAIL（list_sessions 无 owner_id 参数 / 无归属校验）

- [ ] **Step 3: 修改 `backend/stores/session.py`**

```python
def create_session(kb_id: str, title: str = "", owner_id: str = "") -> dict:
    db = get_knora_db()
    sid = f"ses-{uuid.uuid4().hex[:8]}"
    db.execute("INSERT INTO sessions (id, kb_id, title, owner_id) VALUES (?, ?, ?, ?)",
               (sid, kb_id, title, owner_id))
    db.commit()
    return {"id": sid, "kb_id": kb_id, "title": title, "owner_id": owner_id}


def list_sessions(kb_id: str | None = None, owner_id: str | None = None) -> list[dict]:
    db = get_knora_db()
    sql = "SELECT id, kb_id, title, owner_id, created_at FROM sessions"
    conds, params = [], []
    if kb_id:
        conds.append("kb_id = ?")
        params.append(kb_id)
    if owner_id is not None:
        # 个人：自己的 + 无主遗留（owner_id=''）；admin 传 None 看全部
        conds.append("(owner_id = ? OR owner_id = '')")
        params.append(owner_id)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY created_at DESC"
    rows = db.execute(sql, params).fetchall()
    return [{"id": r[0], "kb_id": r[1], "title": r[2], "owner_id": r[3], "created_at": r[4]} for r in rows]
```

同时更新 `get_session` 返回 owner_id：

```python
def get_session(sid: str) -> dict | None:
    db = get_knora_db()
    row = db.execute("SELECT id, kb_id, title, owner_id, created_at FROM sessions WHERE id = ?", (sid,)).fetchone()
    if not row:
        return None
    return {"id": row[0], "kb_id": row[1], "title": row[2], "owner_id": row[3], "created_at": row[4]}
```

- [ ] **Step 4: 修改 `backend/main.py` 的会话路由**

替换 `api_create_session` / `api_list_sessions` / `api_get_session`：

```python
    @app.post("/api/sessions")
    async def api_create_session(req: CreateSessionRequest, user: dict = Depends(get_current_user)):
        return create_session(req.kb_id, req.title, owner_id=user["id"])

    @app.get("/api/sessions")
    async def api_list_sessions(kb_id: str | None = None, user: dict = Depends(get_current_user)):
        if user["role"] == "admin":
            return list_sessions(kb_id)
        return list_sessions(kb_id, owner_id=user["id"])

    @app.get("/api/sessions/{sid}")
    async def api_get_session(sid: str, user: dict = Depends(get_current_user)):
        ses = get_session(sid)
        if not ses:
            raise HTTPException(404, "Session not found")
        if ses["owner_id"] and ses["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "无权访问他人会话")
        messages = get_messages(sid)
        return {**ses, "messages": messages}
```

在 `api_qa`（SSE 路由）中接入用户：函数签名改为 `async def api_qa(req: QARequest, user: dict = Depends(get_current_user))`，并将会话创建处（3 处 `create_session(...)`）补 owner_id，复用会话时校验归属：

```python
            if req.session_id:
                ses = get_session(req.session_id)
                if ses:
                    if ses["owner_id"] and ses["owner_id"] != user["id"] and user["role"] != "admin":
                        raise HTTPException(403, "无权访问他人会话")
                    session_id = req.session_id
                    ...
```

```python
                else:
                    ses = create_session(req.kb_id, req.question[:50], owner_id=user["id"])
                    session_id = ses["id"]
            else:
                ses = create_session(req.kb_id, req.question[:50], owner_id=user["id"])
                session_id = ses["id"]
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_stores.py tests/test_api.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/stores/session.py backend/main.py backend/tests/test_stores.py backend/tests/test_api.py
git commit -m "feat: QA 会话按用户隔离（owner_id + 归属校验）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 碎片与卡片 API

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api.py` 追加

**Interfaces:**
- Consumes: `stores.items.*`
- Produces:
  - `POST /api/fragments {title="", content}` → 个人卡片（form=card, scope=personal, status=draft）
  - `GET /api/fragments` → 我的个人卡片列表（form=card, scope=personal）
  - `POST /api/items {title, content_md, form="card", scope="personal"}` → 知识项（scope=team 时免审直发 published）
  - `GET /api/items?form=&scope=&q=` → 可见知识项（团队 + 自己私有）
  - `GET /api/items/{item_id}` → 知识项 + `links`（引用/被引用）
  - `PUT /api/items/{item_id} {title?, content_md?}` → 仅 owner 且个人私有；团队内容 403
  - `DELETE /api/items/{item_id}` → owner 或 admin
  - `POST /api/items/{item_id}/publish` → 卡片个人→团队（免审）

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_api.py`）

```python
def _auth(client, username="alice"):
    r = client.post("/api/auth/register", json={"username": username, "password": "pw"})
    return {"Authorization": f"Bearer {r.json()['token']}"}

@pytest.mark.asyncio
async def test_fragment_capture_and_list(client):
    headers = _auth(client)
    r = await client.post("/api/fragments", json={"content": "React 18 的并发特性", "title": "碎片一"},
                          headers=headers)
    assert r.status_code == 200
    item = r.json()
    assert item["form"] == "card" and item["scope"] == "personal" and item["status"] == "draft"

    r = await client.get("/api/fragments", headers=headers)
    items = r.json()
    assert len(items) == 1 and items[0]["title"] == "碎片一"

@pytest.mark.asyncio
async def test_create_team_card_direct(client):
    headers = _auth(client)
    r = await client.post("/api/items", json={"title": "团队卡", "content_md": "内容", "scope": "team"},
                          headers=headers)
    assert r.status_code == 200
    assert r.json()["scope"] == "team" and r.json()["status"] == "published"

@pytest.mark.asyncio
async def test_publish_fragment_to_team(client):
    headers = _auth(client)
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=headers)).json()
    r = await client.post(f"/api/items/{frag['id']}/publish", headers=headers)
    assert r.status_code == 200
    assert r.json()["scope"] == "team" and r.json()["status"] == "published"

@pytest.mark.asyncio
async def test_items_visibility_between_users(client):
    alice = _auth(client, "alice")
    bob = _auth(client, "bob")
    await client.post("/api/fragments", json={"content": "alice 私有"}, headers=alice)
    await client.post("/api/items", json={"title": "公共卡", "content_md": "c", "scope": "team"}, headers=alice)

    r = await client.get("/api/items", headers=bob)
    titles = [i["title"] for i in r.json()]
    assert "公共卡" in titles and "alice 私有" not in titles

@pytest.mark.asyncio
async def test_item_detail_with_links(client):
    headers = _auth(client)
    a = (await client.post("/api/items", json={"title": "卡A", "content_md": "a", "scope": "team"}, headers=headers)).json()
    b = (await client.post("/api/items", json={"title": "卡B", "content_md": "b", "scope": "team"}, headers=headers)).json()
    r = await client.get(f"/api/items/{a['id']}", headers=headers)
    assert r.status_code == 200 and r.json()["id"] == a["id"]

@pytest.mark.asyncio
async def test_edit_personal_item_only(client):
    alice = _auth(client, "alice")
    bob = _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=alice)).json()
    # bob 不能改 alice 的私有
    r = await client.put(f"/api/items/{frag['id']}", json={"title": "hack"}, headers=bob)
    assert r.status_code == 403
    # alice 自己可以
    r = await client.put(f"/api/items/{frag['id']}", json={"title": "改好了"}, headers=alice)
    assert r.status_code == 200 and r.json()["title"] == "改好了"

@pytest.mark.asyncio
async def test_team_published_is_read_only(client):
    headers = _auth(client)
    card = (await client.post("/api/items", json={"title": "团队卡", "content_md": "c", "scope": "team"}, headers=headers)).json()
    r = await client.put(f"/api/items/{card['id']}", json={"title": "篡改"}, headers=headers)
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_delete_item_owner_or_admin(client):
    alice = _auth(client, "alice")
    bob = _auth(client, "bob")
    frag = (await client.post("/api/fragments", json={"content": "x"}, headers=alice)).json()
    r = await client.delete(f"/api/items/{frag['id']}", headers=bob)
    assert r.status_code == 403
    r = await client.delete(f"/api/items/{frag['id']}", headers=alice)
    assert r.status_code == 200
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: FAIL（404，路由不存在）

- [ ] **Step 3: 在 `backend/main.py` 追加路由**（放在 Sessions 段之后、Tasks 段之前）

3.1 先补 import（放在第 16-17 行 session/task store import 之后）：

```python
from backend.stores.items import (
    create_item, get_item, list_items, update_item, delete_item,
    publish_card, submit_item, add_link,
)
```

3.2 追加路由：

```python
    # ── 碎片与知识项 ──
    class FragmentRequest(BaseModel):
        title: str = ""
        content: str

    class ItemRequest(BaseModel):
        title: str = ""
        content_md: str = ""
        form: str = "card"
        scope: str = "personal"

    class ItemUpdateRequest(BaseModel):
        title: str | None = None
        content_md: str | None = None

    @app.post("/api/fragments")
    async def api_create_fragment(req: FragmentRequest, user: dict = Depends(get_current_user)):
        if not req.content.strip():
            raise HTTPException(400, "碎片内容不能为空")
        item = create_item(user["id"], req.title or req.content[:40], req.content,
                           form="card", scope="personal")
        return item

    @app.get("/api/fragments")
    async def api_list_fragments(user: dict = Depends(get_current_user)):
        return list_items(user["id"], scope="personal", form="card")

    @app.post("/api/items")
    async def api_create_item(req: ItemRequest, user: dict = Depends(get_current_user)):
        try:
            return create_item(user["id"], req.title, req.content_md,
                               form=req.form, scope=req.scope)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/items")
    async def api_list_items(form: str | None = None, scope: str | None = None,
                             q: str | None = None, user: dict = Depends(get_current_user)):
        return list_items(user["id"], scope=scope, form=form, q=q)

    @app.get("/api/items/{item_id}")
    async def api_get_item(item_id: str, user: dict = Depends(get_current_user)):
        item = get_item(item_id)
        if not item:
            raise HTTPException(404, "知识项不存在")
        if item["scope"] == "personal" and item["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "无权访问")
        return {**item, "links": list_links(item_id)}

    @app.put("/api/items/{item_id}")
    async def api_update_item(item_id: str, req: ItemUpdateRequest, user: dict = Depends(get_current_user)):
        item = get_item(item_id)
        if not item:
            raise HTTPException(404, "知识项不存在")
        if item["scope"] == "team" and item["status"] == "published":
            raise HTTPException(403, "已发布内容只读")
        if item["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "只有作者可编辑")
        return update_item(item_id, title=req.title, content_md=req.content_md)

    @app.delete("/api/items/{item_id}")
    async def api_delete_item(item_id: str, user: dict = Depends(get_current_user)):
        item = get_item(item_id)
        if not item:
            raise HTTPException(404, "知识项不存在")
        if item["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "只有作者或管理员可删除")
        from backend.knowledge.item_index import delete_item_index
        delete_item_index(item_id)
        delete_item(item_id)
        return {"deleted": True}

    @app.post("/api/items/{item_id}/publish")
    async def api_publish_item(item_id: str, user: dict = Depends(get_current_user)):
        item = get_item(item_id)
        if not item:
            raise HTTPException(404, "知识项不存在")
        if item["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "只有作者可发布")
        try:
            published = publish_card(item_id)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return published
```

注意：`api_delete_item` 引用了 `backend.knowledge.item_index.delete_item_index` —— **Task 9 才实现该函数**；若 Task 9 未完成，先注释掉这两行 import 与调用，Task 9 时恢复。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: PASS（含 8 个新用例；若因 Step 3 末尾的 item_index 引用失败，按注释说明处理）

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_api.py
git commit -m "feat: 碎片捕获与知识项 API（创建/列表/详情/编辑/发布）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: AI 沉淀服务（sediment.py）

**Files:**
- Create: `backend/sediment.py`
- Test: `backend/tests/test_sediment.py`

**Interfaces:**
- Consumes: `AsyncOpenAI` 客户端（调用方传入）
- Produces:
  - `async refine_qa_to_card(client, model, question: str, answer: str) -> dict[str, str]`
    - 返回 `{"title": str, "content": str}`；LLM 失败时降级 `{"title": question[:40], "content": answer}`
  - `async draft_article(client, model, cards: list[dict], title_hint: str = "") -> dict[str, str]`
    - 返回 `{"title": str, "content": str}`（markdown 正文）；失败时降级拼接卡片
  - 两个函数都通过 `response_format={"type": "json_object"}` 或先取 `choices[0].message.content` 再容错解析

- [ ] **Step 1: 写失败的测试** `backend/tests/test_sediment.py`

```python
import asyncio
from backend.sediment import refine_qa_to_card, draft_article


class FakeLLM:
    """返回预置 JSON 的假客户端。"""
    def __init__(self, reply: str):
        self.reply = reply

    async def chat_completions_create(self, **kwargs):
        class Msg:
            content = self.reply
        class Choice:
            message = Msg()
        class Resp:
            choices = [Choice()]
        return Resp()


def test_refine_qa_to_card():
    llm = FakeLLM('{"title": "卡片标题", "content": "卡片正文"}')
    result = asyncio.run(refine_qa_to_card(llm, "model", "问题", "回答"))
    assert result == {"title": "卡片标题", "content": "卡片正文"}


def test_refine_qa_to_card_fallback():
    class Broken:
        async def chat_completions_create(self, **kwargs):
            raise RuntimeError("llm down")
    result = asyncio.run(refine_qa_to_card(Broken(), "model", "问题", "回答"))
    assert result["title"] == "问题"[:40]
    assert result["content"] == "回答"


def test_refine_qa_to_card_malformed_json():
    llm = FakeLLM("不是 JSON 的回复")
    result = asyncio.run(refine_qa_to_card(llm, "model", "问题", "回答"))
    assert result["content"] == "回答"


def test_draft_article():
    llm = FakeLLM('{"title": "聚合文章", "content": "# 文章\\n\\n正文"}')
    cards = [{"title": "卡1", "content_md": "c1"}, {"title": "卡2", "content_md": "c2"}]
    result = asyncio.run(draft_article(llm, "model", cards, "标题提示"))
    assert result["title"] == "聚合文章"


def test_draft_article_fallback():
    class Broken:
        async def chat_completions_create(self, **kwargs):
            raise RuntimeError("llm down")
    cards = [{"title": "卡1", "content_md": "c1"}]
    result = asyncio.run(draft_article(Broken(), "model", cards))
    assert "卡1" in result["title"] and "c1" in result["content"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_sediment.py -v`
Expected: FAIL（`No module named 'backend.sediment'`）

- [ ] **Step 3: 实现 `backend/sediment.py`**

```python
"""AI 沉淀服务：QA → 卡片提炼、卡片组 → 文章起草。LLM 失败时降级为原始内容。"""
import json

_CARD_PROMPT = """你是知识库整理助手。把下面的问答提炼成一张知识卡片。
要求：标题 10-30 字；正文 100-300 字，结构清晰，只保留可复用的事实与结论。
只输出 JSON：{"title": "标题", "content": "正文"}

问题：{question}
回答：{answer}"""

_ARTICLE_PROMPT = """你是团队知识库编辑。基于以下知识卡片起草一篇 markdown 文章。
要求：
- 用 # 作为一级标题，内容 500-1000 字；
- 组织成一个连贯的整体，不要逐卡罗列；
- 在末尾以「参考卡片」小节列出卡片标题。
只输出 JSON：{"title": "文章标题", "content": "markdown 正文"}

{cards}"""


async def _chat_json(client, model: str, prompt: str) -> dict:
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    content = resp.choices[0].message.content or ""
    return json.loads(content)


async def refine_qa_to_card(client, model: str, question: str, answer: str) -> dict[str, str]:
    try:
        data = await _chat_json(client, model, _CARD_PROMPT.format(question=question, answer=answer))
        return {"title": str(data["title"])[:80], "content": str(data["content"])}
    except Exception:
        return {"title": question[:40], "content": answer}


async def draft_article(client, model: str, cards: list[dict], title_hint: str = "") -> dict[str, str]:
    card_text = "\n\n".join(
        f"### {c.get('title', '')}\n{c.get('content_md', '')}" for c in cards
    )
    try:
        data = await _chat_json(client, model, _ARTICLE_PROMPT.format(cards=card_text))
        return {"title": str(data["title"])[:80], "content": str(data["content"])}
    except Exception:
        joined = "\n\n".join(f"### {c.get('title', '')}\n{c.get('content_md', '')}" for c in cards)
        return {"title": title_hint or (cards[0]["title"] + " 等" if cards else "新文章"),
                "content": joined}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_sediment.py -v`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add backend/sediment.py backend/tests/test_sediment.py
git commit -m "feat: AI 沉淀服务（QA提炼卡片、卡片组起草文章，LLM失败降级）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 知识项向量索引（item_index.py + vector_store 扩展）

**Files:**
- Create: `backend/knowledge/item_index.py`
- Modify: `backend/knowledge/vector_store.py`
- Modify: `backend/database.py`（vectors.db 的 item_vec0/item_fts 表）
- Test: `backend/tests/test_item_index.py`

**Interfaces:**
- Consumes: `Embedder`（async embed）、`Chunker`、`get_vectors_db`
- Produces:
  - `vector_store.insert_item_vectors(records) -> None`（records: `{item_id, vector, text, keywords}`）
  - `vector_store.search_item_vector(query_vector, top_k=20) -> list[dict]`（只命中 team+published；返回 `{chunk_id=item_id, content, doc_id, title, score, source:"item_vector"}`）
  - `vector_store.search_item_keyword(keywords, top_k=10) -> list[dict]`
  - `vector_store.delete_item_vectors(item_id) -> None`
  - `async item_index.index_item(item: dict, embedder) -> None`（切片→embed→insert）
  - `item_index.delete_item_index(item_id) -> None`（转发 delete_item_vectors）

- [ ] **Step 1: 写失败的测试** `backend/tests/test_item_index.py`

```python
import asyncio
import tempfile
from backend.database import init_databases, get_vectors_db, get_knora_db
from backend.config import Config
from backend.stores.users import create_user
from backend.stores.items import create_item, approve_item, submit_item
from backend.knowledge.vector_store import (
    search_item_vector, search_item_keyword, delete_item_vectors, insert_item_vectors,
)


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def _embed_stub(texts):
    """2048 维确定性向量（内容相关）。"""
    import hashlib
    vecs = []
    for t in texts:
        h = hashlib.sha256(t.encode()).digest()
        vec = [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]
        vecs.append(vec)
    return vecs

def _index_team_item(title, content):
    owner = create_user("alice", "pw")["id"]
    item = create_item(owner, title, content, scope="team")  # team → published
    vecs = _embed_stub([content])
    insert_item_vectors([{"item_id": item["id"], "vector": vecs[0],
                          "text": f"{title}\n{content}", "keywords": title}])
    return item

def test_insert_and_vector_search():
    item = _index_team_item("Kubernetes 部署", "集群部署需要配置 kubeconfig 和网络插件")
    vecs = _embed_stub(["部署集群配置 kubeconfig"])
    results = search_item_vector(vecs[0], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)
    assert results[0]["doc_id"] == item["id"]

def test_keyword_search_items():
    item = _index_team_item("React 并发", "React 18 引入并发特性")
    results = search_item_keyword(["并发"], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)

def test_personal_items_excluded():
    owner = create_user("bob", "pw")["id"]
    priv = create_item(owner, "私有笔记", "不可检索的私人内容")
    vecs = _embed_stub(["私人内容"])
    insert_item_vectors([{"item_id": priv["id"], "vector": vecs[0],
                          "text": "私有笔记 不可检索的私人内容", "keywords": "私有"}])
    results = search_item_keyword(["私人"], top_k=5)
    assert all(r["chunk_id"] != priv["id"] for r in results)

def test_delete_item_vectors():
    item = _index_team_item("临时卡", "临时内容")
    delete_item_vectors(item["id"])
    results = search_item_keyword(["临时"], top_k=5)
    assert all(r["chunk_id"] != item["id"] for r in results)

def test_index_item_end_to_end():
    import hashlib
    class StubEmbedder:
        async def embed(self, texts):
            vecs = []
            for t in texts:
                h = hashlib.sha256(t.encode()).digest()
                vecs.append([((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)])
            return vecs

    from backend.knowledge.item_index import index_item, delete_item_index
    owner = create_user("carol", "pw")["id"]
    item = create_item(owner, "端到端", "这是一段用于端到端索引测试的内容", scope="team")
    asyncio.run(index_item(item, StubEmbedder()))
    results = search_item_keyword(["端到端"], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)
    delete_item_index(item["id"])
    results = search_item_keyword(["端到端"], top_k=5)
    assert all(r["chunk_id"] != item["id"] for r in results)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_item_index.py -v`
Expected: FAIL（表/函数不存在）

- [ ] **Step 3: `backend/database.py` 的 `_ensure_vectors_schema` 末尾追加**（`conn.commit()` 之前）

```python
    conn.execute(f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS item_vec0 USING vec0(
            vector FLOAT[{dimensions}],
            item_id TEXT
        )
    """)
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS item_fts USING fts5(
            item_id UNINDEXED,
            text,
            keywords
        )
    """)
```

- [ ] **Step 4: `backend/knowledge/vector_store.py` 追加**

```python
# ---------------------------------------------------------------------------
# Knowledge-item search (RAG: 只检索 scope=team AND status=published)
# ---------------------------------------------------------------------------

def insert_item_vectors(records: list[dict]) -> None:
    vec_db = get_vectors_db()
    for rec in records:
        blob = _vector_to_blob(rec["vector"])
        vec_db.execute("INSERT INTO item_vec0 (vector, item_id) VALUES (?, ?)",
                       (blob, rec["item_id"]))
        vec_db.execute("INSERT INTO item_fts (item_id, text, keywords) VALUES (?, ?, ?)",
                       (rec["item_id"], rec.get("text", ""), rec.get("keywords", "")))
    vec_db.commit()


def _fetch_item_row(item_id: str):
    """返回 team+published 知识项的 (id, title, content)；不可检索返回 None。"""
    knora_db = get_knora_db()
    return knora_db.execute(
        "SELECT id, title, content_md FROM knowledge_items "
        "WHERE id = ? AND scope = 'team' AND status = 'published'",
        (item_id,),
    ).fetchone()


def search_item_vector(query_vector: list[float], top_k: int = 20) -> list[dict]:
    vec_db = get_vectors_db()
    blob = _vector_to_blob(query_vector)
    try:
        rows = vec_db.execute(
            "SELECT item_id, distance FROM item_vec0 WHERE vector MATCH ? "
            "ORDER BY distance LIMIT ?",
            (blob, top_k),
        ).fetchall()
    except Exception:
        rows = vec_db.execute(
            "SELECT item_id, vec_distance_L2(vector, ?) AS dist FROM item_vec0 ORDER BY dist LIMIT ?",
            (blob, top_k),
        ).fetchall()
    results = []
    for row in rows:
        item = _fetch_item_row(row[0])
        if not item:
            continue
        results.append({
            "chunk_id": item[0], "content": item[2], "doc_id": item[0],
            "score": 1.0 - float(row[1]), "title": item[1], "source": "item_vector",
        })
    return results


def search_item_keyword(keywords: list[str], top_k: int = 10) -> list[dict]:
    vec_db = get_vectors_db()
    query = " OR ".join(keywords)
    try:
        rows = vec_db.execute(
            "SELECT item_id, rank FROM item_fts WHERE item_fts MATCH ? ORDER BY rank LIMIT ?",
            (query, top_k),
        ).fetchall()
    except Exception:
        return []
    results = []
    for row in rows:
        item = _fetch_item_row(row[0])
        if not item:
            continue
        results.append({
            "chunk_id": item[0], "content": item[2], "doc_id": item[0],
            "score": float(row[1]) if row[1] else 0.0, "title": item[1],
            "source": "item_keyword",
        })
    return results


def delete_item_vectors(item_id: str) -> None:
    vec_db = get_vectors_db()
    vec_db.execute("DELETE FROM item_vec0 WHERE item_id = ?", (item_id,))
    vec_db.execute("DELETE FROM item_fts WHERE item_id = ?", (item_id,))
    vec_db.commit()
```

- [ ] **Step 5: 实现 `backend/knowledge/item_index.py`**

```python
"""知识项向量索引：切片 → embedding → 写入 item_vec0/item_fts。"""
from backend.knowledge.chunker import Chunker
from backend.knowledge.vector_store import insert_item_vectors, delete_item_vectors


async def index_item(item: dict, embedder) -> None:
    """对团队已发布的知识项建立向量索引（幂等：先清旧索引）。"""
    delete_item_vectors(item["id"])
    chunks = Chunker(chunk_size=256, chunk_overlap=30).split(item["content_md"] or "")
    vectors = await embedder.embed(chunks)
    records = [
        {"item_id": item["id"], "vector": vectors[i],
         "text": f"{item['title']}\n{chunks[i]}", "keywords": item["title"]}
        for i in range(len(chunks))
    ]
    insert_item_vectors(records)


def delete_item_index(item_id: str) -> None:
    delete_item_vectors(item_id)
```

- [ ] **Step 6: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_item_index.py -v`
Expected: PASS（5 passed）

- [ ] **Step 7: 提交**

```bash
git add backend/database.py backend/knowledge/vector_store.py backend/knowledge/item_index.py backend/tests/test_item_index.py
git commit -m "feat: 知识项向量索引（item_vec0/item_fts，只索引团队已发布内容）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: SearchPlugin 合并知识项结果（RAG 团队层过滤）

**Files:**
- Modify: `backend/pipeline/plugins/search.py`
- Test: `backend/tests/test_search_plugins.py` 追加

**Interfaces:**
- Consumes: `vector_store.search_item_vector/search_item_keyword`
- Produces: `SearchPlugin` 在原有 chunk 检索后，追加一次全局 item 检索，RRF 合并进 `event.search_results`（`source="item_vector"/"item_keyword"`）。仅当 `event.intent == "kb_search"` 时执行。

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_search_plugins.py` 末尾）

```python
@pytest.mark.asyncio
async def test_search_plugin_includes_team_items():
    import asyncio
    from backend.pipeline.plugins.search import SearchPlugin
    from backend.pipeline.events import PipelineEvent
    from backend.stores.users import create_user
    from backend.stores.items import create_item
    from backend.knowledge.vector_store import insert_item_vectors

    owner = create_user("searcher", "pw")["id"]
    item = create_item(owner, "团队检索卡", "这个卡片讲的是异步任务队列的实现", scope="team")
    # 伪造固定向量
    import hashlib
    h = hashlib.sha256("异步任务队列".encode()).digest()
    vec = [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]
    insert_item_vectors([{"item_id": item["id"], "vector": vec,
                          "text": "团队检索卡 这个卡片讲的是异步任务队列的实现",
                          "keywords": "异步"}])

    class StubEmbedder:
        async def embed_single(self, text):
            h = hashlib.sha256(text.encode()).digest()
            return [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]

    plugin = SearchPlugin(embedder=StubEmbedder(), top_k=10, keyword_top_k=5, rrf_k=60)
    event = PipelineEvent(question="异步任务队列怎么做？", kb_ids=["kb-x"], intent="kb_search",
                          rewritten_queries=["异步任务队列"], keywords=["异步"])
    event = await plugin.process(event)
    assert any(r.chunk_id == item["id"] for r in event.search_results)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_search_plugins.py -v`
Expected: FAIL（item 不在结果里；测试需 `setup_module` 初始化数据库——若文件已有则直接复用）

- [ ] **Step 3: 修改 `backend/pipeline/plugins/search.py`**

在 `process` 中、`all_keyword.extend(keyword_results)` 之后加 item 检索：

```python
        # 知识项检索（团队已发布内容，全局不过滤 KB）
        all_vector.extend(await self._item_vector_search(event))
        all_keyword.extend(await self._item_keyword_search(event))
```

并在类中追加两个方法：

```python
    async def _item_vector_search(self, event: PipelineEvent) -> list[dict]:
        from backend.knowledge.vector_store import search_item_vector
        try:
            all_results = []
            seen = set()
            for query in event.rewritten_queries[:3]:
                vec = await self.embedder.embed_single(query)
                for r in search_item_vector(vec, self.top_k):
                    if r["chunk_id"] not in seen:
                        seen.add(r["chunk_id"])
                        all_results.append(r)
            return all_results
        except Exception:
            return []

    async def _item_keyword_search(self, event: PipelineEvent) -> list[dict]:
        from backend.knowledge.vector_store import search_item_keyword
        if not event.keywords:
            return []
        return search_item_keyword(event.keywords, self.keyword_top_k)
```

`_rrf_merge` 无需改动：item 结果已带 `chunk_id/doc_id/title/content/source`，天然兼容。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_search_plugins.py tests/test_item_index.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/pipeline/plugins/search.py backend/tests/test_search_plugins.py
git commit -m "feat: 检索合并团队知识项（RAG 只检索已发布团队内容）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: QA 沉淀与文章起草 API

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api.py` 追加（monkeypatch sediment 函数）

**Interfaces:**
- Consumes: `sediment.refine_qa_to_card`, `sediment.draft_article`, `stores.items.*`, `stores.reviews.create_review_task`, `stores.session.get_messages`
- Produces:
  - `POST /api/sessions/{sid}/sediment {kind: "card"|"article"}` → 基于该会话最新问答，创建个人卡片（AI 提炼）或文章草稿（AI 起草，引用 QA 来源）；返回知识项
  - `POST /api/articles/draft {title?, item_ids: list[str]}` → 基于卡片组 AI 起草文章（个人草稿 + `references` 链接到各卡片）；返回知识项
  - 会话沉淀后写入 `item_derivations(source_type='qa', source_ref=session_id)`
  - 沉淀与起草都要求会话归属校验（本人/admin）

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_api.py`）

```python
@pytest.mark.asyncio
async def test_sediment_session_to_card(client, monkeypatch):
    from backend import sediment
    async def fake_refine(client, model, question, answer):
        return {"title": "提炼卡", "content": "提炼后的内容"}
    monkeypatch.setattr(sediment, "refine_qa_to_card", fake_refine)

    headers = _auth(client, "alice")
    r = await client.post("/api/sessions", json={"kb_id": "", "title": "会话"}, headers=headers)
    sid = r.json()["id"]
    # 塞一条问答（模拟 SSE 已保存）
    from backend.stores.session import create_message
    from backend.database import get_knora_db  # 无需——create_message 直接入库
    create_message(sid, "user", "异步队列怎么实现？", "[]", 0)
    create_message(sid, "assistant", "用 celery 实现", "[]", 10)

    r = await client.post(f"/api/sessions/{sid}/sediment", json={"kind": "card"}, headers=headers)
    assert r.status_code == 200
    item = r.json()
    assert item["form"] == "card" and item["scope"] == "personal"
    assert item["title"] == "提炼卡"

    # 派生记录
    from backend.database import get_knora_db
    row = get_knora_db().execute(
        "SELECT 1 FROM item_derivations WHERE item_id = ? AND source_ref = ?",
        (item["id"], sid)).fetchone()
    assert row is not None

@pytest.mark.asyncio
async def test_sediment_requires_ownership(client, monkeypatch):
    from backend import sediment
    async def fake_refine(client, model, question, answer):
        return {"title": "t", "content": "c"}
    monkeypatch.setattr(sediment, "refine_qa_to_card", fake_refine)

    alice = _auth(client, "alice")
    bob = _auth(client, "bob")
    r = await client.post("/api/sessions", json={"kb_id": "", "title": "s"}, headers=alice)
    sid = r.json()["id"]
    r = await client.post(f"/api/sessions/{sid}/sediment", json={"kind": "card"}, headers=bob)
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_draft_article_from_cards(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "聚合文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)

    headers = _auth(client, "alice")
    c1 = (await client.post("/api/items", json={"title": "卡1", "content_md": "内容1", "scope": "team"}, headers=headers)).json()
    c2 = (await client.post("/api/items", json={"title": "卡2", "content_md": "内容2", "scope": "team"}, headers=headers)).json()
    r = await client.post("/api/articles/draft", json={"item_ids": [c1["id"], c2["id"]]}, headers=headers)
    assert r.status_code == 200
    art = r.json()
    assert art["form"] == "article" and art["scope"] == "personal" and art["status"] == "draft"
    # 引用链接
    from backend.database import get_knora_db
    n = get_knora_db().execute(
        "SELECT COUNT(*) FROM item_links WHERE source_id = ? AND type = 'references'",
        (art["id"],)).fetchone()[0]
    assert n == 2
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: FAIL（404）

- [ ] **Step 3: `backend/main.py` 追加路由**（放在 items 段之后、Tasks 段之前）

```python
    # ── QA 沉淀与文章起草 ──
    class SedimentRequest(BaseModel):
        kind: str = "card"   # "card" | "article"

    class DraftRequest(BaseModel):
        title: str = ""
        item_ids: list[str]

    def _get_session_messages(sid: str) -> tuple[str, str]:
        """取会话最后一条问答；无则返回 ("", "")。"""
        from backend.stores.session import get_messages as _get_messages
        msgs = _get_messages(sid)
        question = answer = ""
        for m in msgs:
            if m["role"] == "user":
                question = m["content"]
            elif m["role"] == "assistant":
                answer = m["content"]
        return question, answer

    @app.post("/api/sessions/{sid}/sediment")
    async def api_sediment_session(sid: str, req: SedimentRequest, user: dict = Depends(get_current_user)):
        ses = get_session(sid)
        if not ses:
            raise HTTPException(404, "会话不存在")
        if ses["owner_id"] and ses["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "无权沉淀他人会话")
        question, answer = _get_session_messages(sid)
        if not question or not answer:
            raise HTTPException(400, "该会话还没有问答内容")

        client = AsyncOpenAI(api_key=cfg.llm.api_key, base_url=cfg.llm.base_url)
        from backend import sediment
        if req.kind == "card":
            draft = await sediment.refine_qa_to_card(client, cfg.llm.model, question, answer)
            item = create_item(user["id"], draft["title"], draft["content"],
                               form="card", scope="personal")
        elif req.kind == "article":
            draft = await sediment.draft_article(
                client, cfg.llm.model,
                [{"title": question[:40], "content_md": f"{question}\n\n{answer}"}],
                title_hint=question[:40],
            )
            item = create_item(user["id"], draft["title"], draft["content"],
                               form="article", scope="personal")
        else:
            raise HTTPException(400, "kind 必须是 card 或 article")
        from backend.database import get_knora_db
        get_knora_db().execute(
            "INSERT OR IGNORE INTO item_derivations (item_id, source_type, source_ref) VALUES (?, 'qa', ?)",
            (item["id"], sid))
        get_knora_db().commit()
        return item

    @app.post("/api/articles/draft")
    async def api_draft_article(req: DraftRequest, user: dict = Depends(get_current_user)):
        if not req.item_ids:
            raise HTTPException(400, "至少选择一张卡片")
        cards = []
        for cid in req.item_ids:
            card = get_item(cid)
            if not card:
                raise HTTPException(404, f"卡片不存在: {cid}")
            if card["form"] != "card":
                raise HTTPException(400, f"{cid} 不是卡片")
            if card["scope"] == "personal" and card["owner_id"] != user["id"]:
                raise HTTPException(403, f"无权引用他人私有卡片: {cid}")
            cards.append(card)

        client = AsyncOpenAI(api_key=cfg.llm.api_key, base_url=cfg.llm.base_url)
        from backend import sediment
        draft = await sediment.draft_article(client, cfg.llm.model, cards, title_hint=req.title)
        item = create_item(user["id"], draft["title"], draft["content"],
                           form="article", scope="personal")
        for card in cards:
            add_link(item["id"], card["id"], "references")  # add_link 已在 Task 7 导入
        return item
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: PASS（含 3 个新用例）

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_api.py
git commit -m "feat: QA 沉淀（卡片/文章）与卡片组起草文章 API

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: 审核 API 与管理员用户管理

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api.py` 追加

**Interfaces:**
- Consumes: `stores.reviews.*`, `stores.users.*`, `item_index.index_item`（approve 后异步建索引）
- Produces:
  - `POST /api/items/{item_id}/submit`（作者本人）→ 文章 draft → pending + 建审核任务
  - `POST /api/items/{item_id}/review {action: "approve"|"reject", reason}`（admin）→ 批准（发布团队 + 建向量索引）/ 驳回（回草稿 + 清索引）
  - `GET /api/admin/reviews`（admin）→ 待审列表
  - `GET /api/admin/users`（admin）→ 用户列表
  - `POST /api/admin/users/{user_id}/deactivate`（admin）→ 停用

- [ ] **Step 1: 写失败的测试**（追加到 `backend/tests/test_api.py`）

```python
@pytest.mark.asyncio
async def test_article_submit_and_admin_review(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "待审文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)

    alice = _auth(client, "alice")
    # fixture 首个注册用户是 tester=admin；alice 是普通用户（作者）
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]

    # 起草文章（alice）
    r = await client.post("/api/articles/draft", json={"item_ids": []}, headers=alice)
    # 空卡片组应 400；先造卡片
    c = (await client.post("/api/items", json={"title": "卡", "content_md": "x", "scope": "team"}, headers=alice)).json()
    r = await client.post("/api/articles/draft", json={"item_ids": [c["id"]]}, headers=alice)
    art = r.json()
    assert art["status"] == "draft"

    # 提交审核
    r = await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "pending"

    # 非 admin 审批 → 403
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "approve", "reason": ""}, headers=alice)
    assert r.status_code == 403

    # 待审列表（admin）
    r = await client.get("/api/admin/reviews", headers={"Authorization": f"Bearer {admin_token}"})
    assert any(t["item_id"] == art["id"] for t in r.json())

    # admin 批准 → 发布
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "approve", "reason": "可以"}, headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    item = (await client.get(f"/api/items/{art['id']}", headers=alice)).json()
    assert item["status"] == "published" and item["scope"] == "team"

@pytest.mark.asyncio
async def test_review_reject_returns_to_draft(client, monkeypatch):
    from backend import sediment
    async def fake_draft(client, model, cards, title_hint=""):
        return {"title": "驳回文章", "content": "# 正文"}
    monkeypatch.setattr(sediment, "draft_article", fake_draft)
    alice = _auth(client, "alice")
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]
    c = (await client.post("/api/items", json={"title": "卡", "content_md": "x", "scope": "team"}, headers=alice)).json()
    art = (await client.post("/api/articles/draft", json={"item_ids": [c["id"]]}, headers=alice)).json()
    await client.post(f"/api/items/{art['id']}/submit", headers=alice)
    r = await client.post(f"/api/items/{art['id']}/review",
                          json={"action": "reject", "reason": "缺引用"},
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    item = (await client.get(f"/api/items/{art['id']}", headers=alice)).json()
    assert item["status"] == "draft" and item["scope"] == "personal"

@pytest.mark.asyncio
async def test_admin_user_management(client):
    r = await client.post("/api/auth/login", json={"username": "tester", "password": "pw"})
    admin_token = r.json()["token"]
    await client.post("/api/auth/register", json={"username": "victim", "password": "pw"})
    users = (await client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})).json()
    victim = next(u for u in users if u["username"] == "victim")
    r = await client.post(f"/api/admin/users/{victim['id']}/deactivate",
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    # 停用后登录失败
    r = await client.post("/api/auth/login", json={"username": "victim", "password": "pw"})
    assert r.status_code == 401
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: FAIL（404）

- [ ] **Step 3: `backend/main.py` 追加路由**（Tasks 段之前）

```python
    # ── 审核与管理 ──
    class ReviewRequest(BaseModel):
        action: str  # "approve" | "reject"
        reason: str = ""

    @app.post("/api/items/{item_id}/submit")
    async def api_submit_item(item_id: str, user: dict = Depends(get_current_user)):
        item = get_item(item_id)
        if not item:
            raise HTTPException(404, "知识项不存在")
        if item["owner_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "只有作者可提交")
        from backend.stores.reviews import create_review_task
        try:
            submit_item(item_id)
        except ValueError as e:
            raise HTTPException(400, str(e))
        create_review_task(item_id)
        return get_item(item_id)

    @app.post("/api/items/{item_id}/review")
    async def api_review_item(item_id: str, req: ReviewRequest, user: dict = Depends(require_admin)):
        from backend.stores.reviews import approve_review, reject_review, get_review_task
        from backend.knowledge.item_index import index_item
        if not get_review_task(item_id):
            raise HTTPException(404, "该文章没有待审任务")
        item = get_item(item_id)
        if req.action == "approve":
            approve_review(item_id, user["id"], req.reason)
            asyncio.create_task(index_item(item, Embedder(
                client=AsyncOpenAI(api_key=cfg.embedding.api_key, base_url=cfg.embedding.base_url),
                model=cfg.embedding.model, dimensions=cfg.embedding.dimensions,
            )))
        elif req.action == "reject":
            from backend.knowledge.item_index import delete_item_index
            reject_review(item_id, user["id"], req.reason)
            delete_item_index(item_id)
        else:
            raise HTTPException(400, "action 必须是 approve 或 reject")
        return get_item(item_id)

    @app.get("/api/admin/reviews")
    async def api_list_reviews(user: dict = Depends(require_admin)):
        from backend.stores.reviews import list_review_tasks
        return list_review_tasks(status="pending")

    @app.get("/api/admin/users")
    async def api_list_users(user: dict = Depends(require_admin)):
        return list_users()

    @app.post("/api/admin/users/{user_id}/deactivate")
    async def api_deactivate_user(user_id: str, user: dict = Depends(require_admin)):
        if user_id == user["id"]:
            raise HTTPException(400, "不能停用自己")
        set_user_active(user_id, False)
        return {"deactivated": True}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/test_api.py -v`
Expected: PASS（含 3 个新用例）

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_api.py
git commit -m "feat: 文章提交审核、管理员审批/驳回、用户管理 API

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: 前端认证（AuthContext + 登录注册页 + 路由守卫 + API 头）

**Files:**
- Create: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/RegisterPage.tsx`
- Modify: `frontend/src/api/opencodewiki.ts`
- Modify: `frontend/src/types/opencodewiki.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: 后端 `/api/auth/*`
- Produces:
  - `types/opencodewiki.ts`: `User {id, username, role, active}`, `KnowledgeItem {id, title, content_md, form, scope, status, owner_id, created_at, updated_at, published_at?, links?}`, `ReviewTask {id, item_id, title, owner_id, action, reason, created_at}`
  - `api/opencodewiki.ts`: `register(u,p)`, `login(u,p)`, `fetchMe()`, `fetchFragments()`, `createFragment(content, title?)`, `createItem(payload)`, `fetchItems(params?)`, `fetchItem(id)`, `updateItem(id, patch)`, `deleteItemApi(id)`, `publishItem(id)`, `sedimentSession(sid, kind)`, `draftArticle(itemIds, title?)`, `submitItem(id)`, `reviewItem(id, action, reason)`, `fetchReviews()`, `fetchAdminUsers()`, `deactivateUser(id)`
  - `AuthContext`: `{user, token, login, register, logout, loading}`；token 存 `localStorage['ocw_token']`
  - `App.tsx`：`<AuthProvider>` 包裹；`/login`、`/register` 公开，其余路由在 `RequireAuth` 内
  - `api/opencodewiki.ts` 的 `request()` 自动带 `Authorization: Bearer <token>`；401 时清 token 跳 `/login`

- [ ] **Step 1: 类型** — 追加到 `frontend/src/types/opencodewiki.ts`

```ts
export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  active: boolean
}

export interface KnowledgeItem {
  id: string
  title: string
  content_md: string
  form: 'card' | 'article'
  scope: 'personal' | 'team'
  status: 'draft' | 'pending' | 'published'
  owner_id: string
  created_at: string
  updated_at: string
  published_at: string | null
  links?: { id: string; title: string; form: string; type: string; direction: 'in' | 'out' }[]
}

export interface ReviewTask {
  id: string
  item_id: string
  title: string
  owner_id: string
  action: 'pending' | 'approved' | 'rejected'
  reason: string
  created_at: string
}
```

- [ ] **Step 2: API 客户端** — 修改 `frontend/src/api/opencodewiki.ts`。先把第 1 行 import 更新为：

```ts
import type { KB, Document, Session, Message, Config, User, KnowledgeItem, ReviewTask } from '@/types/opencodewiki'
```

再修改顶部 `request` 与 `askQuestion`：

```ts
const TOKEN_KEY = 'ocw_token'

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY) }
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  })
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null)
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login'
    throw new Error('未登录')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || body.message || `HTTP ${res.status}`)
  }
  return res.json()
}
```

`askQuestion` 同样加 token 头：

```ts
export function askQuestion(kbId: string, question: string, sessionId?: string): Promise<Response> {
  return fetch(`${BASE}/api/qa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()!}` } : {}),
    },
    body: JSON.stringify({ kb_id: kbId, question, session_id: sessionId || '' }),
  })
}
```

文件末尾追加新 API：

```ts
// Auth
export function register(username: string, password: string): Promise<{ token: string; user: User }> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}
export function login(username: string, password: string): Promise<{ token: string; user: User }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}
export function fetchMe(): Promise<User> { return request('/api/auth/me') }

// Fragments & Items
export function fetchFragments(): Promise<KnowledgeItem[]> { return request('/api/fragments') }
export function createFragment(content: string, title?: string): Promise<KnowledgeItem> {
  return request('/api/fragments', { method: 'POST', body: JSON.stringify({ content, title: title || '' }) })
}
export function fetchItems(params?: { form?: string; scope?: string; q?: string }): Promise<KnowledgeItem[]> {
  const qs = new URLSearchParams()
  if (params?.form) qs.set('form', params.form)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.q) qs.set('q', params.q)
  const s = qs.toString()
  return request(`/api/items${s ? `?${s}` : ''}`)
}
export function fetchItem(id: string): Promise<KnowledgeItem> { return request(`/api/items/${id}`) }
export function createItem(payload: { title: string; content_md: string; form?: string; scope?: string }): Promise<KnowledgeItem> {
  return request('/api/items', { method: 'POST', body: JSON.stringify(payload) })
}
export function updateItem(id: string, patch: { title?: string; content_md?: string }): Promise<KnowledgeItem> {
  return request(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
}
export function deleteItemApi(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/items/${id}`, { method: 'DELETE' })
}
export function publishItem(id: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/publish`, { method: 'POST' })
}

// Sedimentation & Review
export function sedimentSession(sid: string, kind: 'card' | 'article'): Promise<KnowledgeItem> {
  return request(`/api/sessions/${sid}/sediment`, { method: 'POST', body: JSON.stringify({ kind }) })
}
export function draftArticle(itemIds: string[], title?: string): Promise<KnowledgeItem> {
  return request('/api/articles/draft', { method: 'POST', body: JSON.stringify({ item_ids: itemIds, title: title || '' }) })
}
export function submitItem(id: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/submit`, { method: 'POST' })
}
export function reviewItem(id: string, action: 'approve' | 'reject', reason: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) })
}
export function fetchReviews(): Promise<ReviewTask[]> { return request('/api/admin/reviews') }
export function fetchAdminUsers(): Promise<User[]> { return request('/api/admin/users') }
export function deactivateUser(id: string): Promise<{ deactivated: boolean }> {
  return request(`/api/admin/users/${id}/deactivate`, { method: 'POST' })
}
```

- [ ] **Step 3: `AuthContext.tsx`**

```tsx
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { getToken, setToken, login as apiLogin, register as apiRegister, fetchMe } from '@/api/opencodewiki'
import type { User } from '@/types/opencodewiki'

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null, token: null, loading: true,
  login: async () => {}, register: async () => {}, logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setTokenState] = useState<string | null>(getToken())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    fetchMe()
      .then(setUser)
      .catch(() => { setToken(null); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const res = await apiLogin(username, password)
    setToken(res.token)
    setTokenState(res.token)
    setUser(res.user)
  }
  const register = async (username: string, password: string) => {
    const res = await apiRegister(username, password)
    setToken(res.token)
    setTokenState(res.token)
    setUser(res.user)
  }
  const logout = () => { setToken(null); setTokenState(null); setUser(null) }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 4: `LoginPage.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/qa', { replace: true })
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded-2xl shadow-lg w-80 space-y-4">
        <h1 className="text-xl font-bold text-gray-900 text-center">OpenCodeWiki</h1>
        <p className="text-xs text-gray-400 text-center">团队代码知识平台</p>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="密码"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <button type="submit" disabled={submitting}
          className="w-full bg-cyber-blue text-white rounded-lg py-2 text-sm font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
          {submitting ? '登录中...' : '登录'}
        </button>
        <p className="text-xs text-gray-400 text-center">
          没有账号？<Link to="/register" className="text-cyber-blue hover:underline">注册</Link>（首个注册用户为管理员）
        </p>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: `RegisterPage.tsx`**（同结构，提交后 `navigate('/qa')`，文案"注册"）

```tsx
import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('两次密码不一致'); return }
    if (password.length < 4) { setError('密码至少 4 位'); return }
    setSubmitting(true)
    try {
      await register(username, password)
      navigate('/qa', { replace: true })
    } catch (err: any) {
      setError(err.message || '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded-2xl shadow-lg w-80 space-y-4">
        <h1 className="text-xl font-bold text-gray-900 text-center">注册账号</h1>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="密码（至少 4 位）"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" placeholder="确认密码"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <button type="submit" disabled={submitting}
          className="w-full bg-cyber-blue text-white rounded-lg py-2 text-sm font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
          {submitting ? '注册中...' : '注册'}
        </button>
        <p className="text-xs text-gray-400 text-center">
          已有账号？<Link to="/login" className="text-cyber-blue hover:underline">登录</Link>
        </p>
      </form>
    </div>
  )
}
```

- [ ] **Step 6: `App.tsx` 改造** — 完整替换为：

```tsx
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SourcesPage } from '@/pages/SourcesPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { FragmentsPage } from '@/pages/FragmentsPage'
import { CardsPage } from '@/pages/CardsPage'

function QAPageRoute() {
  const { sessionId } = useParams()
  const loc = useLocation()
  const navKey = `${sessionId || 'new'}-${loc.key}`
  return <QAPage key={navKey} />
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth()
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Shell() {
  return (
    <LayoutProvider>
      <div className="h-screen flex overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<RequireAuth><Navigate to="/qa" replace /></RequireAuth>} />
            <Route path="/wiki/:name" element={<RequireAuth><WikiGlobalPage /></RequireAuth>} />
            <Route path="/wiki" element={<RequireAuth><WikiGlobalPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="/qa" element={<RequireAuth><QAPageRoute /></RequireAuth>} />
            <Route path="/qa/:sessionId" element={<RequireAuth><QAPageRoute /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
            <Route path="/sources" element={<RequireAuth><SourcesPage /></RequireAuth>} />
            <Route path="/fragments" element={<RequireAuth><FragmentsPage /></RequireAuth>} />
            <Route path="/cards" element={<RequireAuth><CardsPage /></RequireAuth>} />
          </Routes>
        </div>
      </div>
    </LayoutProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
```

注意：登录/注册页仍渲染 AppSidebar（布局不变）——若要整页居中展示，可让 `Shell` 在 login/register 路径下不渲染侧边栏，本计划保持简单：侧边栏常驻（登录页也能看到导航，点击即被守卫弹回登录页，可接受）。若希望隐藏，可在 Shell 内判断 `location.pathname` 再渲染。

- [ ] **Step 7: `LoginPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from './LoginPage'

vi.mock('@/api/opencodewiki', () => ({
  getToken: () => null,
  setToken: vi.fn(),
  login: vi.fn(async () => ({ token: 't', user: { id: 'u', username: 'alice', role: 'admin', active: true } })),
  register: vi.fn(),
  fetchMe: vi.fn(async () => { throw new Error('no token') }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

describe('LoginPage', () => {
  it('should render form fields', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument()
    expect(screen.getByText('登录')).toBeInTheDocument()
  })

  it('should show error on empty submit', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.click(screen.getByText('登录'))
    await waitFor(() => expect(screen.getByText(/登录失败|用户名|密码/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 8: 运行确认通过**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS（2 passed）

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过（无类型错误）

- [ ] **Step 9: 提交**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/pages/LoginPage.tsx frontend/src/pages/RegisterPage.tsx frontend/src/api/opencodewiki.ts frontend/src/types/opencodewiki.ts frontend/src/App.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat: 前端登录/注册与路由守卫（AuthContext + Bearer 头）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 侧边栏导航改造（6 项顺序 + 登录态用户块）

**Files:**
- Modify: `frontend/src/components/layout/AppSidebar.tsx`
- Modify: `frontend/src/contexts/LayoutContext.tsx`（TabType 扩展）

**Interfaces:**
- Consumes: `useAuth()`（Task 13）
- Produces: 导航顺序 `新问题(/qa) → 我的碎片(/fragments) → Wiki(/wiki) → 知识沉淀(/admin) → 知识卡片(/cards) → 知识库(/sources)`；底部用户块显示真实用户名 + 退出登录；未登录显示"登录"。

- [ ] **Step 1: `LayoutContext.tsx` TabType 扩展**

```tsx
export type TabType = 'read' | 'qa' | 'wiki' | 'manage' | 'fragments' | 'cards' | null
```

- [ ] **Step 2: `AppSidebar.tsx` 修改**

2.1 顶部 import 追加：

```tsx
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate as _nav } from 'react-router-dom'  // 已存在 navigate，无需新增
import { LogOut, LogIn } from 'lucide-react'
```

（`navigate` 已存在，只需补 `useAuth` 与图标 import。）

2.2 组件内取用户：

```tsx
  const { user, logout } = useAuth()
```

2.3 导航数组（第 175-180 行的数组）替换为：

```tsx
          {[
            { key: 'qa' as TabType, icon: MessageSquare, label: '新问题', path: '/qa' },
            { key: 'fragments' as TabType, icon: StickyNote, label: '我的碎片', path: '/fragments' },
            { key: 'read' as TabType, icon: BookOpen, label: 'Wiki', path: '/wiki' },
            { key: 'wiki' as TabType, icon: FileText, label: '知识沉淀', path: '/admin' },
            { key: 'cards' as TabType, icon: LayoutGrid, label: '知识卡片', path: '/cards' },
            { key: 'sources' as TabType, icon: Database, label: '知识库', path: '/sources' },
          ].map(tab => (
```

（`StickyNote`、`LayoutGrid` 加入 lucide-react import。）

2.4 底部用户块（第 294-305 行）替换为：

```tsx
          {/* User info */}
          {user ? (
            <div className="flex items-center gap-[8px] px-[10px] h-[36px] rounded-lg text-sidebar-text/60">
              <div className="w-7 h-7 rounded-full bg-slate-600/50 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0">
                {user.username[0]?.toUpperCase()}
              </div>
              {sidebarOpen && (
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-sidebar-text/80 truncate">{user.username}</div>
                  <div className="text-[10px] text-slate-500 truncate">{user.role === 'admin' ? '管理员' : '成员'}</div>
                </div>
              )}
              <button onClick={logout} title="退出登录"
                className="text-slate-500 hover:text-red-400 transition-colors shrink-0">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => navigate('/login')} title="登录"
              className="flex items-center gap-[8px] h-[36px] px-[10px] rounded-lg text-sidebar-text/60 hover:bg-white/5 hover:text-sidebar-active transition-colors">
              <LogIn className="w-[18px] h-[18px] shrink-0" />
              {sidebarOpen && <span className="text-sm font-semibold">登录</span>}
            </button>
          )}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/layout/AppSidebar.tsx frontend/src/contexts/LayoutContext.tsx
git commit -m "feat: 侧边栏新增我的碎片/知识卡片入口与登录态用户块

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: 我的碎片页（FragmentsPage）

**Files:**
- Create: `frontend/src/pages/FragmentsPage.tsx`
- Test: `frontend/src/pages/FragmentsPage.test.tsx`

**Interfaces:**
- Consumes: `fetchFragments`, `createFragment`, `publishItem`, `draftArticle`, `navigate`
- Produces: 页面功能——顶部捕获输入框（textarea + 发布为卡片按钮）、碎片列表（标题/内容/时间 + 「发布到团队」按钮）、底部「选中卡片起草文章」批量操作（多选 checkbox + 按钮跳转/调用 draftArticle 后跳转卡片页详情）

- [ ] **Step 1: 实现 `FragmentsPage.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchFragments, createFragment, publishItem, draftArticle } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { StickyNote, Loader2, Send, Sparkles, Check } from 'lucide-react'

export function FragmentsPage() {
  const navigate = useNavigate()
  const [fragments, setFragments] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drafting, setDrafting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchFragments().then(setFragments).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const handleCapture = async () => {
    if (!content.trim()) return
    setCapturing(true)
    try {
      await createFragment(content.trim())
      setContent('')
      showToast('碎片已捕获')
      load()
    } catch (e: any) {
      showToast(e.message || '捕获失败')
    } finally {
      setCapturing(false)
    }
  }

  const handlePublish = async (id: string) => {
    try {
      await publishItem(id)
      showToast('已发布到团队')
      load()
    } catch (e: any) {
      showToast(e.message || '发布失败')
    }
  }

  const handleDraftArticle = async () => {
    if (selected.size === 0) return
    setDrafting(true)
    try {
      const art = await draftArticle([...selected])
      navigate(`/cards`, { state: { highlight: art.id } })
    } catch (e: any) {
      showToast(e.message || '起草失败')
    } finally {
      setDrafting(false)
    }
  }

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-lg font-bold text-gray-900">我的碎片</h1>
            <p className="text-xs text-gray-400 mt-1">捕获零散知识，发布后沉淀为团队卡片</p>
          </div>

          {/* Capture box */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="随手记下一段知识碎片，例如：'Flux 模式要求单向数据流，store 只能通过 action 更新'"
              rows={3}
              className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400">{content.length} 字</span>
              <button onClick={handleCapture} disabled={capturing || !content.trim()}
                className="flex items-center gap-1.5 bg-cyber-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
                {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                捕获为卡片
              </button>
            </div>
          </div>

          {toast && <div className="text-xs text-cyber-blue bg-cyber-blue/10 rounded-lg px-3 py-2">{toast}</div>}

          {/* List */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : fragments.length === 0 ? (
            <div className="text-center py-16">
              <StickyNote className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">还没有碎片，从上方捕获第一条吧</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fragments.map(f => (
                <div key={f.id} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)}
                    className="mt-1 accent-cyber-blue" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800 truncate">{f.title}</h3>
                      <span className="text-[10px] text-gray-300 shrink-0">{f.created_at?.slice(0, 10)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap line-clamp-3">{f.content_md}</p>
                  </div>
                  <button onClick={() => handlePublish(f.id)}
                    className="self-start flex items-center gap-1 text-xs text-cyber-blue border border-cyber-blue/30 rounded-lg px-2.5 py-1 hover:bg-cyber-blue/10 shrink-0">
                    <Sparkles className="w-3 h-3" /> 发布到团队
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected.size > 0 && (
            <button onClick={handleDraftArticle} disabled={drafting}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-gray-900 text-white rounded-full px-5 py-2.5 text-sm shadow-lg hover:bg-gray-800 disabled:opacity-50">
              {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              选中 {selected.size} 张，起草文章
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `FragmentsPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FragmentsPage } from './FragmentsPage'

const mockFragments = [
  { id: 'it-1', title: '碎片一', content_md: 'React 18 并发特性', form: 'card', scope: 'personal', status: 'draft',
    owner_id: 'u', created_at: '2026-08-03T00:00:00', updated_at: '', published_at: null },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchFragments: vi.fn(async () => mockFragments),
  createFragment: vi.fn(async () => mockFragments[0]),
  publishItem: vi.fn(async () => ({ ...mockFragments[0], scope: 'team', status: 'published' })),
  draftArticle: vi.fn(async () => ({ id: 'it-art', title: '文章', content_md: '# x', form: 'article', scope: 'personal', status: 'draft', owner_id: 'u', created_at: '', updated_at: '', published_at: null })),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('FragmentsPage', () => {
  it('should render capture box and fragment list', async () => {
    render(<MemoryRouter><FragmentsPage /></MemoryRouter>)
    expect(screen.getByPlaceholderText(/随手记下/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('碎片一')).toBeInTheDocument())
  })

  it('should capture new fragment on submit', async () => {
    render(<MemoryRouter><FragmentsPage /></MemoryRouter>)
    const textarea = screen.getByPlaceholderText(/随手记下/)
    fireEvent.change(textarea, { target: { value: '新的碎片内容' } })
    fireEvent.click(screen.getByText('捕获为卡片'))
    await waitFor(() => expect(screen.getByText('碎片已捕获')).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd frontend && npx vitest run src/pages/FragmentsPage.test.tsx && npx tsc --noEmit`
Expected: PASS + 类型通过

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/FragmentsPage.tsx frontend/src/pages/FragmentsPage.test.tsx
git commit -m "feat: 我的碎片页（捕获/发布/批量起草文章）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: 知识卡片页（CardsPage）

**Files:**
- Create: `frontend/src/pages/CardsPage.tsx`
- Test: `frontend/src/pages/CardsPage.test.tsx`

**Interfaces:**
- Consumes: `fetchItems`, `createItem`, `fetchItem`
- Produces: 页面——形态/可见性过滤（全部/团队/仅自己）、卡片列表（标题+内容+可见性标识）、「新增卡片」按钮（弹表单，可选发布到团队）、点卡片详情（右栏显示内容与引用链接）

- [ ] **Step 1: 实现 `CardsPage.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { fetchItems, createItem } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { LayoutGrid, Loader2, Plus, X, Eye } from 'lucide-react'

type Filter = 'all' | 'team' | 'mine'

export function CardsPage() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<KnowledgeItem | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [toTeam, setToTeam] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchItems({ form: 'card' })
      .then(list => setItems(list.filter(i => filter === 'all' || (filter === 'team' ? i.scope === 'team' : i.scope === 'personal'))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])
  useEffect(() => { load() }, [load])

  const openDetail = async (id: string) => {
    try {
      const item = await fetchItem(id)
      setSelected(item)
    } catch {}
  }

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return
    setSubmitting(true)
    try {
      await createItem({ title: title.trim(), content_md: content.trim(), scope: toTeam ? 'team' : 'personal' })
      setShowCreate(false); setTitle(''); setContent(''); setToTeam(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">知识卡片</h1>
              <p className="text-xs text-gray-400 mt-1">团队公开 + 自己的私有卡片，发布后团队可见</p>
            </div>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 bg-cyber-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-cyber-blue-dark">
              <Plus className="w-4 h-4" /> 新增卡片
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {([['all', '全部'], ['team', '团队'], ['mine', '仅自己']] as [Filter, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`text-xs rounded-full px-3 py-1 transition-colors ${
                  filter === k ? 'bg-cyber-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <LayoutGrid className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">还没有卡片</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(i => (
                <button key={i.id} onClick={() => openDetail(i.id)}
                  className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-cyber-blue/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{i.title}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                      i.scope === 'team' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {i.scope === 'team' ? '团队' : '仅自己可见'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5 line-clamp-3 whitespace-pre-wrap">{i.content_md}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail side panel */}
      {selected && (
        <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto p-5 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">{selected.title}</h2>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-1.5 mt-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${selected.scope === 'team' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {selected.scope === 'team' ? '团队' : '仅自己可见'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{selected.form}</span>
          </div>
          <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap">{selected.content_md}</div>
          {selected.links && selected.links.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                <Eye className="w-3 h-3" /> 引用链接
              </div>
              <ul className="mt-2 space-y-1">
                {selected.links.map((l, idx) => (
                  <li key={idx} className="text-xs text-cyber-blue">{l.direction === 'in' ? '被引用 ← ' : '引用 → '}{l.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[480px] space-y-3">
            <h2 className="text-sm font-bold text-gray-900">新增卡片</h2>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="卡片内容"
              rows={5}
              className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={toTeam} onChange={e => setToTeam(e.target.checked)} className="accent-cyber-blue" />
              直接发布到团队（免审）
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="text-xs text-gray-400 px-3 py-2 hover:text-gray-600">取消</button>
              <button onClick={handleCreate} disabled={submitting || !title.trim() || !content.trim()}
                className="bg-cyber-blue text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
                {submitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `CardsPage.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CardsPage } from './CardsPage'

const mockItems = [
  { id: 'it-1', title: '团队卡', content_md: '公开内容', form: 'card', scope: 'team', status: 'published',
    owner_id: 'u', created_at: '', updated_at: '', published_at: null },
  { id: 'it-2', title: '私有卡', content_md: '私有内容', form: 'card', scope: 'personal', status: 'draft',
    owner_id: 'u', created_at: '', updated_at: '', published_at: null },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchItems: vi.fn(async () => mockItems),
  fetchItem: vi.fn(async (id: string) => ({ ...mockItems.find(i => i.id === id), links: [] })),
  createItem: vi.fn(async () => mockItems[0]),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('CardsPage', () => {
  it('should render team and personal cards with badges', async () => {
    render(<CardsPage />)
    await waitFor(() => {
      expect(screen.getByText('团队卡')).toBeInTheDocument()
      expect(screen.getByText('私有卡')).toBeInTheDocument()
    })
    expect(screen.getAllByText('团队').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('仅自己可见').length).toBeGreaterThanOrEqual(1)
  })

  it('should filter to team only', async () => {
    render(<CardsPage />)
    await waitFor(() => expect(screen.getByText('团队卡')).toBeInTheDocument())
    screen.getByText('团队').click()
    await waitFor(() => expect(screen.queryByText('私有卡')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd frontend && npx vitest run src/pages/CardsPage.test.tsx && npx tsc --noEmit`
Expected: PASS + 类型通过

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/CardsPage.tsx frontend/src/pages/CardsPage.test.tsx
git commit -m "feat: 知识卡片页（过滤/新增/详情引用链接）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 17: QA 页沉淀按钮（SedimentMenu）

**Files:**
- Create: `frontend/src/components/qa/SedimentMenu.tsx`
- Modify: `frontend/src/pages/QAPage.tsx`
- Test: `frontend/src/components/qa/SedimentMenu.test.tsx`

**Interfaces:**
- Consumes: `sedimentSession(sid, kind)`；`useAuth`（获取当前用户）
- Produces: 组件 `SedimentMenu({ sessionId, disabled, onDone })` —— 下拉菜单：「沉淀为卡片」「沉淀为文章」；成功后 `onDone(item)`。

- [ ] **Step 1: 实现 `SedimentMenu.tsx`**

```tsx
import { useState } from 'react'
import { sedimentSession } from '@/api/opencodewiki'
import type { KnowledgeItem } from '@/types/opencodewiki'
import { Sparkles, ChevronDown, Loader2 } from 'lucide-react'

export function SedimentMenu({ sessionId, disabled, onDone }: {
  sessionId: string
  disabled?: boolean
  onDone?: (item: KnowledgeItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (kind: 'card' | 'article') => {
    if (!sessionId || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const item = await sedimentSession(sessionId, kind)
      setOpen(false)
      setMsg(kind === 'card' ? '已沉淀为卡片（可在我的碎片查看）' : '已起草文章（可在知识卡片提交审核）')
      onDone?.(item)
    } catch (e: any) {
      setMsg(e.message || '沉淀失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={disabled || busy}
        className="flex items-center gap-1.5 text-xs text-cyber-blue border border-cyber-blue/30 rounded-lg px-3 py-1.5 hover:bg-cyber-blue/10 disabled:opacity-40 transition-colors">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        沉淀
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-30">
          <button onClick={() => run('card')} className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            沉淀为卡片
          </button>
          <button onClick={() => run('article')} className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            沉淀为文章（草稿）
          </button>
        </div>
      )}
      {msg && <div className="absolute right-0 mt-1 w-52 text-[11px] bg-gray-900 text-white rounded-lg px-3 py-2 z-30">{msg}</div>}
    </div>
  )
}
```

- [ ] **Step 2: 接入 `QAPage.tsx`** —— 共享输入栏 `renderInputBar`（约 line 504）中，在「新对话」按钮块（line 512-517 `{!compact && (<button ...新对话...>)}`）之后插入：

```tsx
        {activeSessionId && (
          <SedimentMenu sessionId={activeSessionId}
            disabled={!messages.length || streaming}
            onDone={() => {}} />
        )}
```

并在文件顶部 import：

```tsx
import { SedimentMenu } from '@/components/qa/SedimentMenu'
```

（`renderInputBar` 有 `compact` 参数，`{!compact && ...}` 内的块在 compact 模式下不渲染；`activeSessionId` 与 `messages` 均为 QAPage 已有 state，直接可用。若渲染位置需要调整，以该处 JSX 结构为准，保持按钮不遮挡输入框即可。）

- [ ] **Step 3: `SedimentMenu.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SedimentMenu } from './SedimentMenu'

vi.mock('@/api/opencodewiki', () => ({
  sedimentSession: vi.fn(async () => ({ id: 'it-1', title: '沉淀卡', content_md: 'c', form: 'card', scope: 'personal', status: 'draft', owner_id: 'u', created_at: '', updated_at: '', published_at: null })),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('SedimentMenu', () => {
  it('should render menu items after click', async () => {
    render(<SedimentMenu sessionId="ses-1" />)
    fireEvent.click(screen.getByText('沉淀'))
    expect(screen.getByText('沉淀为卡片')).toBeInTheDocument()
    expect(screen.getByText('沉淀为文章（草稿）')).toBeInTheDocument()
  })

  it('should call sediment on card click', async () => {
    render(<SedimentMenu sessionId="ses-1" />)
    fireEvent.click(screen.getByText('沉淀'))
    fireEvent.click(screen.getByText('沉淀为卡片'))
    await waitFor(() => expect(screen.getByText(/已沉淀为卡片/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend && npx vitest run src/components/qa/SedimentMenu.test.tsx && npx tsc --noEmit`
Expected: PASS + 类型通过

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/qa/SedimentMenu.tsx frontend/src/pages/QAPage.tsx frontend/src/components/qa/SedimentMenu.test.tsx
git commit -m "feat: QA 页沉淀菜单（沉淀为卡片/文章）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 18: 审核台（ReviewPanel 接入 AdminPage）

**Files:**
- Create: `frontend/src/components/review/ReviewPanel.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`
- Test: `frontend/src/components/review/ReviewPanel.test.tsx`

**Interfaces:**
- Consumes: `fetchReviews`, `reviewItem`, `useAuth`
- Produces: 组件 `ReviewPanel()` —— 待审文章列表（标题/作者/时间 + 打开正文 + 批准/驳回（填理由））；仅在 `user.role === 'admin'` 时渲染。

- [ ] **Step 1: 实现 `ReviewPanel.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { fetchReviews, reviewItem, fetchItem } from '@/api/opencodewiki'
import type { ReviewTask, KnowledgeItem } from '@/types/opencodewiki'
import { Loader2, Check, X, Eye } from 'lucide-react'

export function ReviewPanel() {
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<{ task: ReviewTask; item: KnowledgeItem } | null>(null)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchReviews().then(setTasks).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const openDetail = async (task: ReviewTask) => {
    try {
      const item = await fetchItem(task.item_id)
      setDetail({ task, item })
      setReason('')
    } catch {}
  }

  const act = async (action: 'approve' | 'reject') => {
    if (!detail) return
    if (action === 'reject' && !reason.trim()) { setToast('驳回需填写理由'); return }
    setActing(true)
    try {
      await reviewItem(detail.task.item_id, action, reason)
      setToast(action === 'approve' ? '已批准并发布' : '已驳回')
      setDetail(null)
      load()
    } catch (e: any) {
      setToast(e.message || '操作失败')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">待审文章</h2>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
      </div>
      {toast && <div className="text-xs text-cyber-blue bg-cyber-blue/10 rounded-lg px-3 py-2">{toast}</div>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">暂无待审文章</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-800 truncate">{t.title}</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">提交于 {t.created_at?.slice(0, 10)}</p>
              </div>
              <button onClick={() => openDetail(t)}
                className="flex items-center gap-1 text-xs text-cyber-blue border border-cyber-blue/30 rounded-lg px-2.5 py-1 hover:bg-cyber-blue/10 shrink-0 ml-3">
                <Eye className="w-3 h-3" /> 审阅
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-[640px] max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">{detail.item.title}</h2>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 text-sm text-gray-700 whitespace-pre-wrap">{detail.item.content_md}</div>
            <div className="p-5 border-t border-gray-100 space-y-3">
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="审批意见（驳回必填）"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-cyber-blue" />
              <div className="flex justify-end gap-2">
                <button onClick={() => act('reject')} disabled={acting}
                  className="flex items-center gap-1 text-xs text-red-500 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 disabled:opacity-50">
                  <X className="w-3.5 h-3.5" /> 驳回
                </button>
                <button onClick={() => act('approve')} disabled={acting}
                  className="flex items-center gap-1 text-xs text-white bg-emerald-500 rounded-lg px-3 py-2 hover:bg-emerald-600 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> 批准发布
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 接入 `AdminPage.tsx`** —— 顶部 import：

```tsx
import { useAuth } from '@/contexts/AuthContext'
import { ReviewPanel } from '@/components/review/ReviewPanel'
```

组件内：

```tsx
  const { user } = useAuth()
```

在页面标题下方（`QA 对话转为结构化 Wiki 文档...` 的 `<p>` 之后）追加：

```tsx
            {user?.role === 'admin' && (
              <div className="mt-6">
                <ReviewPanel />
              </div>
            )}
```

- [ ] **Step 3: `ReviewPanel.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ReviewPanel } from './ReviewPanel'

const mockTasks = [
  { id: 'rev-1', item_id: 'it-1', title: '待审文章一', owner_id: 'u', action: 'pending', reason: '', created_at: '2026-08-03T00:00:00' },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchReviews: vi.fn(async () => mockTasks),
  fetchItem: vi.fn(async () => ({ id: 'it-1', title: '待审文章一', content_md: '# 正文内容', form: 'article', scope: 'personal', status: 'pending', owner_id: 'u', created_at: '', updated_at: '', published_at: null, links: [] })),
  reviewItem: vi.fn(async () => ({})),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('ReviewPanel', () => {
  it('should render pending tasks', async () => {
    render(<ReviewPanel />)
    await waitFor(() => expect(screen.getByText('待审文章一')).toBeInTheDocument())
  })

  it('should open detail and approve', async () => {
    render(<ReviewPanel />)
    await waitFor(() => expect(screen.getByText('待审文章一')).toBeInTheDocument())
    screen.getByText('审阅').click()
    await waitFor(() => expect(screen.getByText('# 正文内容')).toBeInTheDocument())
    screen.getByText('批准发布').click()
    await waitFor(() => expect(screen.getByText('已批准并发布')).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend && npx vitest run src/components/review/ReviewPanel.test.tsx && npx tsc --noEmit`
Expected: PASS + 类型通过

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/review/ReviewPanel.tsx frontend/src/pages/AdminPage.tsx frontend/src/components/review/ReviewPanel.test.tsx
git commit -m "feat: 管理员审核台（待审列表、审阅、批准/驳回）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 19: 端到端冒烟

**Files:**
- 无（验证任务）

**Goal:** 全链路验证：注册 → 捕获碎片 → 发布卡片 → QA 沉淀 → 起草文章 → 提交审核 → 批准 → 检索命中。

- [ ] **Step 1: 全量后端测试**

Run: `cd backend && ../backend/.venv/bin/python -m pytest tests/ -v`
Expected: 全部 PASS（含新增 ~40 用例）

- [ ] **Step 2: 全量前端测试 + 类型**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 3: 启动服务**

Run: `bash scripts/start.sh > /tmp/opencodewiki.log 2>&1 &`（或复用已启动实例；若旧实例无鉴权代码，需重启）

- [ ] **Step 4: curl 全流程**

```bash
BASE=http://localhost:8100
# 1. 注册（如已有用户，先登录）
TOKEN=$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"smoke","password":"pw123"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
AUTH="Authorization: Bearer $TOKEN"
# 2. 捕获碎片
FRAG=$(curl -s -X POST $BASE/api/fragments -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"content":"Flux 单向数据流，store 只能通过 action 更新"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "fragment=$FRAG"
# 3. 发布到团队
curl -s -X POST $BASE/api/items/$FRAG/publish -H "$AUTH" | python3 -m json.tool | head -8
# 4. 列表可见
curl -s "$BASE/api/items?form=card&scope=team" -H "$AUTH" | python3 -c 'import json,sys;print([i["title"] for i in json.load(sys.stdin)])'
```

Expected: 注册成功、fragment id 非空、发布后 scope=team、列表含该卡片标题。

- [ ] **Step 5: 提交（如有遗留未提交改动）**

```bash
git status --short
# 确认无遗留后：
git log --oneline -12
```

**计划完成标记：** 全部 19 个任务完成后，第一期核心闭环（用户体系/卡片文章/碎片/沉淀/审核/RAG 团队过滤）即交付。

**本计划明确不做（对照 spec §8 分期）：**
- 代码库自动生成实体文章（spec §4 沉淀动作表第 4 行）—— 现有代码库无 wiki_builder 实体生成模块，属第二期"输入增强"，本计划不实现。
- 链接剪藏、文件导入（第二期）。
- backlink 检索加权（第二期）。
- 角色矩阵、离职迁移（远期）。
- 遗留 Topic/Wiki conversions API 与页面（`/api/topics`、`convert-to-wiki`）第一期保留不动，第二期再移除——QA 沉淀已走新通道，旧通道不再扩展。
