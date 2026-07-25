# SVN 仓库导入支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SVN repository import/sync capability to OpenCodeWiki with credential management and auth-failure dialog.

**Architecture:** SVN CLI wrapper (`svn_sync.py`) parallels existing `git_sync.py`; `SyncRepoPlugin` dispatches by `repo_type`. Auth failures surface via task params, frontend polls and shows password dialog on detection. Credentials stored in `knowledge_bases` table.

**Tech Stack:** Python 3.11+, FastAPI, system `svn` CLI, React 18 (frontend)

## Global Constraints

- All SVN operations use `--non-interactive` to prevent process hanging
- Auth errors detected via stderr matching E215004/E170001
- Credentials stored as plaintext in SQLite (user choice)
- SVN checkout URL derivation: `<repo_url>/<branch>` (branch defaults to `trunk`)
- No Python SVN binding — always shell out to `svn` binary
- `svn update` output parsing: lines starting with `U`/`A`/`D`/`M`/`R` followed by path

---
### Task 1: `backend/sync/svn_sync.py` — 核心 SVN 操作模块

**Files:**
- Create: `backend/sync/svn_sync.py`
- Modify: `backend/sync/__init__.py`
- Test: `backend/tests/test_svn_sync.py`

**Interfaces:**
- Consumes: nothing
- Produces: `checkout(url, dest, branch, username, password)`, `update(dest, username, password) → list[str]`, `get_head_revision(url, branch, username, password) → str`, `get_revision(repo_path) → str`, `list_files(repo_path) → dict[str,str]`, `SVNAuthError`, `is_auth_error(stderr) → bool`

- [ ] **Step 1: Create `svn_sync.py` with `_run_cmd` and auth detection**

```python
import asyncio
import hashlib
import os

_AUTH_ERROR_SIGNATURES = [
    "认证失败",
    "Authentication failed",
    "认证已取消",
    "authorization failed",
    "svn: E215004",
    "svn: E170001",
    "Could not authenticate to server",
    "svn: E200014",
]


class SVNAuthError(RuntimeError):
    """Raised when SVN operations fail because authentication is needed."""
    pass


def is_auth_error(stderr: str) -> bool:
    return any(sig in stderr for sig in _AUTH_ERROR_SIGNATURES)


async def _run_cmd(cmd: list[str], cwd: str | None = None, timeout: int = 300) -> tuple[str, str, int]:
    """Run a command, return (stdout, stderr, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"Command timed out after {timeout}s: {' '.join(cmd)}")
    return stdout.decode(), stderr.decode(), proc.returncode
```

- [ ] **Step 2: Add `_build_svn_url` and credential helpers**

```python
def _build_svn_url(url: str, branch: str) -> str:
    """Build the full SVN URL by appending the branch if not already present."""
    url = url.rstrip("/")
    branch = branch.strip("/") if branch else ""
    if branch and branch != "/" and not url.endswith(f"/{branch}"):
        url = url + "/" + branch
    return url


def _build_auth_args(username: str | None, password: str | None) -> list[str]:
    args = ["--non-interactive", "--trust-server-cert-fail-unknown-ca"]
    if username:
        args.extend(["--username", username])
    if password:
        args.extend(["--password", password])
    return args
```

- [ ] **Step 3: Add `checkout` function**

```python
async def checkout(url: str, dest: str, branch: str = "trunk", username: str | None = None, password: str | None = None) -> None:
    """SVN checkout. Equivalent of git clone."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    svn_url = _build_svn_url(url, branch)
    cmd = ["svn", "checkout"] + _build_auth_args(username, password) + [svn_url, dest]
    stdout, stderr, rc = await _run_cmd(cmd)
    if rc != 0:
        if is_auth_error(stderr):
            raise SVNAuthError(stderr)
        raise RuntimeError(f"svn checkout failed: {stderr}")
```

- [ ] **Step 4: Add `update` function**

```python
async def update(dest: str, username: str | None = None, password: str | None = None) -> list[str]:
    """Update working copy and return list of changed file paths (relative)."""
    cmd = ["svn", "update"] + _build_auth_args(username, password)
    stdout, stderr, rc = await _run_cmd(cmd, cwd=dest)
    if rc != 0:
        if is_auth_error(stderr):
            raise SVNAuthError(stderr)
        raise RuntimeError(f"svn update failed: {stderr}")

    changed = []
    for line in stdout.split("\n"):
        line = line.rstrip()
        # Format: "U   path/to/file" or " U  path" (two status chars, then path)
        if len(line) >= 4 and line[0] in "UADMRCGE!":
            path = line[1:].strip()
            if path:
                changed.append(path)
        elif len(line) >= 4 and line[0] == " " and line[1] in "UADMRCGE!":
            path = line[2:].strip()
            if path:
                changed.append(path)
    return changed
```

- [ ] **Step 5: Add `get_head_revision`, `get_revision`, `list_files`**

```python
async def get_head_revision(url: str, branch: str = "trunk", username: str | None = None, password: str | None = None) -> str:
    """Return the latest revision number (short string)."""
    svn_url = _build_svn_url(url, branch)
    cmd = ["svn", "info", "--show-item", "revision"] + _build_auth_args(username, password) + [svn_url]
    stdout, stderr, rc = await _run_cmd(cmd)
    if rc == 0:
        return stdout.strip()[:7]
    return ""


async def get_revision(repo_path: str) -> str:
    """Return the current revision of the working copy."""
    cmd = ["svn", "info", "--show-item", "revision"]
    stdout, stderr, rc = await _run_cmd(cmd, cwd=repo_path)
    if rc == 0:
        return stdout.strip()
    return ""


async def list_files(repo_path: str) -> dict[str, str]:
    """Walk repo path and return {relative_path: sha256} for supported files, skipping .svn dirs."""
    supported = {".md", ".txt", ".pdf", ".docx"}
    files: dict[str, str] = {}
    for root, dirs, filenames in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d != ".svn"]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in supported:
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, repo_path)
            sha = hashlib.sha256()
            with open(full, "rb") as f:
                while chunk := f.read(8192):
                    sha.update(chunk)
            files[rel] = sha.hexdigest()
    return files
```

- [ ] **Step 6: Run tests to verify it fails (no tests yet, just import check)**

Run: `cd /home/long2015/Code/OpenCodeWiki && cd backend && python -c "from backend.sync import svn_sync; print('import OK')"`

- [ ] **Step 7: Update `backend/sync/__init__.py`**

```python
from . import git_sync, svn_sync
```

- [ ] **Step 8: Create `backend/tests/test_svn_sync.py`**

```python
import os
import tempfile
import pytest
from unittest.mock import patch, AsyncMock
from backend.sync.svn_sync import (
    is_auth_error, SVNAuthError, _build_svn_url,
    _build_auth_args, list_files,
)


class TestSVNSyncUtils:

    def test_is_auth_error_detects_e215004(self):
        assert is_auth_error("svn: E215004: authentication error")

    def test_is_auth_error_detects_e170001(self):
        assert is_auth_error("svn: E170001: authentication required")

    def test_is_auth_error_returns_false_for_other_errors(self):
        assert not is_auth_error("svn: E000001: file not found")
        assert not is_auth_error("")

    def test_build_svn_url_appends_trunk(self):
        assert _build_svn_url("svn://example.com/repo", "trunk") == "svn://example.com/repo/trunk"

    def test_build_svn_url_does_not_duplicate_branch(self):
        assert _build_svn_url("svn://example.com/repo/trunk", "trunk") == "svn://example.com/repo/trunk"

    def test_build_svn_url_handles_empty_branch(self):
        assert _build_svn_url("svn://example.com/repo", "") == "svn://example.com/repo"

    def test_build_svn_url_handles_branches_path(self):
        assert _build_svn_url("svn://example.com/repo", "branches/feature") == "svn://example.com/repo/branches/feature"

    def test_build_auth_args_no_creds(self):
        args = _build_auth_args(None, None)
        assert "--username" not in args
        assert "--password" not in args

    def test_build_auth_args_with_creds(self):
        args = _build_auth_args("alice", "secret")
        assert "--username" in args
        assert "--password" in args
        assert args[args.index("--username") + 1] == "alice"
        assert args[args.index("--password") + 1] == "secret"

    def test_list_files_skips_svn_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Create a file in the repo root
            with open(os.path.join(tmp, "readme.md"), "w") as f:
                f.write("# Hello")
            # Create a .svn directory (simulated)
            svn_dir = os.path.join(tmp, ".svn")
            os.makedirs(svn_dir)
            with open(os.path.join(svn_dir, "entries"), "w") as f:
                f.write("dummy")

            files = list_files(tmp)
            assert "readme.md" in files
            assert ".svn/entries" not in files


class TestSVNAuthError:

    def test_is_exception(self):
        try:
            raise SVNAuthError("auth failed")
        except SVNAuthError:
            assert True
        except RuntimeError:
            assert True  # inherits from RuntimeError
```

- [ ] **Step 9: Run the unit tests**

Run: `cd /home/long2015/Code/OpenCodeWiki && cd backend && python -m pytest tests/test_svn_sync.py -v`

Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
cd /home/long2015/Code/OpenCodeWiki
git add backend/sync/svn_sync.py backend/sync/__init__.py backend/tests/test_svn_sync.py
git commit -m "feat(svn): add svn_sync module with checkout/update/list_files

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 2: 数据库迁移 + KB Store 凭证支持

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/stores/kb.py`

**Interfaces:**
- Consumes: Task 1 (svn_sync module exists)
- Produces: `create_kb(...)` accepts svn_username/svn_password, `get_kb()`/`list_kbs()` returns them, `update_kb_credentials(kb_id, username, password)` persists

- [ ] **Step 1: Add migration to `backend/database.py`**

Add to `_MIGRATIONS` list:
```python
"ALTER TABLE knowledge_bases ADD COLUMN svn_username TEXT DEFAULT ''",
"ALTER TABLE knowledge_bases ADD COLUMN svn_password TEXT DEFAULT ''",
```

- [ ] **Step 2: Update `_KB_COLS` in `backend/stores/kb.py`**

```python
_KB_COLS = "id, name, description, embedding_model, chunk_config, doc_count, chunk_count, repo_url, repo_type, repo_branch, content_type, repo_version, svn_username, svn_password, created_at"
```

- [ ] **Step 3: Update `_row_to_dict` in `backend/stores/kb.py`**

Update indices (columns shifted by 2):
```python
d = {
    # ... existing fields ...
    "svn_username": row[12] or "",
    "svn_password": row[13] or "",
    "created_at": row[14],
}
```

- [ ] **Step 4: Update `create_kb` to accept credential fields**

```python
def create_kb(name: str, description: str = "", embedding_model: str = "",
              repo_url: str = "", repo_type: str = "", repo_branch: str = "",
              content_type: str = "docs",
              svn_username: str = "", svn_password: str = "") -> dict:
    db = get_knora_db()
    kb_id = f"kb-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO knowledge_bases (id, name, description, embedding_model, repo_url, repo_type, repo_branch, content_type, svn_username, svn_password) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (kb_id, name, description, embedding_model or "text-embedding-3-small",
         repo_url, repo_type, repo_branch, content_type,
         svn_username, svn_password),
    )
    db.commit()
    return {"id": kb_id, "name": name, "description": description, "embedding_model": embedding_model}
```

- [ ] **Step 5: Add `update_kb_credentials` function**

```python
def update_kb_credentials(kb_id: str, username: str, password: str) -> None:
    """Update SVN credentials for a knowledge base."""
    db = get_knora_db()
    db.execute(
        "UPDATE knowledge_bases SET svn_username = ?, svn_password = ? WHERE id = ?",
        (username, password, kb_id),
    )
    db.commit()
```

- [ ] **Step 6: Commit**

```bash
cd /home/long2015/Code/OpenCodeWiki
git add backend/database.py backend/stores/kb.py
git commit -m "feat(db): add svn_username/svn_password columns and KB store support

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 3: SyncRepoPlugin SVN 调度

**Files:**
- Modify: `backend/task_worker/plugins/sync_repo.py`

**Interfaces:**
- Consumes: Task 1 (`svn_sync.checkout`, `svn_sync.update`, `svn_sync.list_files`, `svn_sync.get_revision`, `SVNAuthError`), Task 2 (`get_kb` returns svn_username/svn_password)
- Produces: sync behavior with SVN support, auth_required task state

- [ ] **Step 1: Add import for svn_sync and refactor `process` method**

At the top of `sync_repo.py`, add:
```python
from backend.sync import svn_sync
```

- [ ] **Step 2: Modify `process` method to dispatch by repo_type**

After line `repo_branch = kb.get("repo_branch") or "main"`, add credential extraction:
```python
svn_username = kb.get("svn_username") or ""
svn_password = kb.get("svn_password") or ""
```

Replace `# 1. Clone or pull` block (lines 50-54) with:
```python
# 1. Clone or pull (dispatch by repo_type)
is_svn = kb.get("repo_type") == "svn"
if is_svn:
    if os.path.isdir(local_path):
        await svn_sync.update(local_path, svn_username, svn_password)
    else:
        os.makedirs(local_path, exist_ok=True)
        await svn_sync.checkout(repo_url, local_path, repo_branch, svn_username, svn_password)
else:
    if os.path.isdir(local_path):
        await git_sync.pull(local_path)
    else:
        os.makedirs(local_path, exist_ok=True)
        await git_sync.clone(repo_url, local_path, repo_branch)
```

- [ ] **Step 3: Wrap checkout/update in try/except SVNAuthError**

Wrap the SVN clone/pull section (Step 2 code) in a try/except:
```python
if is_svn:
    try:
        if os.path.isdir(local_path):
            await svn_sync.update(local_path, svn_username, svn_password)
        else:
            os.makedirs(local_path, exist_ok=True)
            await svn_sync.checkout(repo_url, local_path, repo_branch, svn_username, svn_password)
    except svn_sync.SVNAuthError as e:
        update_task_status(event.task_id, "running", progress=10,
                           progress_msg="等待SVN认证...",
                           params={"auth_required": True, "realm": repo_url})
        raise TaskCancelledError()
```

Also need to update `update_task_status` call to include `params`. Let me check the current signature.

The current `update_task_status` in `backend/stores/task.py`:
```python
def update_task_status(task_id, status, progress=None, progress_msg=None, error_message=None):
```

We might need to add a `params` parameter or encode it differently. Looking at the task table schema:
```python
params TEXT DEFAULT '{}'
```

Let me add a `params` param to `update_task_status`:

- [ ] **Step 3a: Add `params` parameter to `update_task_status` in `backend/stores/task.py`**

```python
def update_task_status(task_id: str, status: str, progress: int = None,
                       progress_msg: str = None, error_message: str = None,
                       params: dict = None) -> None:
    db = get_knora_db()
    updates = ["status = ?"]
    values = [status]
    if progress is not None:
        updates.append("progress = ?")
        values.append(progress)
    if progress_msg is not None:
        updates.append("progress_msg = ?")
        values.append(progress_msg)
    if error_message is not None:
        updates.append("error_message = ?")
        values.append(error_message)
    if params is not None:
        import json
        updates.append("params = ?")
        values.append(json.dumps(params))
    values.append(task_id)
    db.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", values)
    db.commit()
```

- [ ] **Step 4: Replace `# 7. Save repo version` section for SVN**

Replace lines 166-174 with:
```python
# 7. Save repo version
from backend.database import get_knora_db
try:
    if is_svn:
        ver = await svn_sync.get_revision(local_path)
    else:
        ver = await git_sync.get_head_commit(local_path)
    if ver:
        db = get_knora_db()
        db.execute("UPDATE knowledge_bases SET repo_version = ? WHERE id = ?", (ver, kb_id))
        db.commit()
except Exception:
    pass
```

- [ ] **Step 5: Handle scan_dir for SVN (code repos) — same behavior as git**

The scan_dir logic (lines 64-91) should work the same for SVN — no changes needed there.

- [ ] **Step 6: Fix `params` parsing in `list_tasks` and `get_task`**

In `backend/stores/task.py`, update `get_task` to parse params:
```python
return {
    "id": row[0], "type": row[1], "status": row[2], "progress": row[3],
    "progress_msg": row[4], "kb_id": row[5], "repo_id": row[6],
    "params": json.loads(row[7]) if row[7] else {},
    "error_message": row[8],
    "created_at": row[9], "started_at": row[10], "completed_at": row[11],
}
```

Update `list_tasks` return to parse params:
```python
return [{
    "id": r[0], "type": r[1], "status": r[2], "progress": r[3],
    "progress_msg": r[4], "kb_id": r[5], "repo_id": r[6],
    "params": json.loads(r[7]) if r[7] else {},
    "error_message": r[8],
    "created_at": r[9], "started_at": r[10], "completed_at": r[11],
} for r in rows]
```

Update `create_task` return to return parsed params:
```python
return {"id": task_id, "type": type, "status": "pending", "progress": 0,
        "kb_id": kb_id, "repo_id": repo_id, "params": params or {},
        "progress_msg": "", "error_message": None}
```

- [ ] **Step 7: Commit**

```bash
cd /home/long2015/Code/OpenCodeWiki
git add backend/task_worker/plugins/sync_repo.py backend/stores/task.py
git commit -m "feat(sync): SyncRepoPlugin dispatches SVN operations, handles auth errors

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 4: Backend API 扩展

**Files:**
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: Task 2 (`create_kb` accepts svn_username/svn_password, `update_kb_credentials`, `get_kb` returns credential fields), Task 3 (SVN dispatch in sync)
- Produces: `POST /api/kb/{kb_id}/svn-auth` endpoint, extended KB creation, SVN-aware `_fetch_commit`

- [ ] **Step 1: Extend `CreateKBRequest` with credential fields**

```python
class CreateKBRequest(BaseModel):
    name: str
    description: str = ""
    repo_url: str = ""
    repo_type: str = ""
    repo_branch: str = ""
    content_type: str = "docs"
    svn_username: str = ""
    svn_password: str = ""
```

- [ ] **Step 2: Update `api_create_kb` to pass credentials**

Update the `create_kb` call:
```python
@app.post("/api/kb")
async def api_create_kb(req: CreateKBRequest):
    kb = create_kb(req.name, req.description, embedding_model=cfg.embedding.model,
                    repo_url=req.repo_url, repo_type=req.repo_type,
                    repo_branch=req.repo_branch, content_type=req.content_type,
                    svn_username=req.svn_username, svn_password=req.svn_password)
    # Fetch remote commit hash in background
    if req.repo_url and req.repo_type == "git":
        asyncio.create_task(_fetch_commit_and_update(kb["id"], req.repo_url, req.repo_branch or "main"))
    elif req.repo_url and req.repo_type == "svn":
        asyncio.create_task(_fetch_commit_and_update(kb["id"], req.repo_url, req.repo_branch or "trunk",
                                                      repo_type="svn", svn_username=req.svn_username, svn_password=req.svn_password))
    return kb
```

- [ ] **Step 3: Update `_fetch_commit_and_update` to accept SVN params**

```python
async def _fetch_commit_and_update(kb_id: str, repo_url: str, branch: str,
                                   repo_type: str = "git",
                                   svn_username: str = "", svn_password: str = "") -> None:
    """Fetch remote commit/revision hash and update KB card immediately."""
    try:
        from backend.database import get_knora_db
        if repo_type == "svn":
            ver = await svn_sync.get_head_revision(repo_url, branch, svn_username, svn_password)
        else:
            ver = await git_sync.get_remote_head_commit(repo_url, branch)
        if ver:
            db = get_knora_db()
            db.execute("UPDATE knowledge_bases SET repo_version = ? WHERE id = ?", (ver, kb_id))
            db.commit()
    except Exception:
        pass  # non-critical
```

- [ ] **Step 4: Add `POST /api/kb/{kb_id}/svn-auth` endpoint**

Add import:
```python
from backend.stores.kb import update_kb_credentials
```

After the existing sync endpoint (`/api/kb/{kb_id}/sync`), add:
```python
@app.post("/api/kb/{kb_id}/svn-auth")
async def api_svn_auth(kb_id: str, data: dict):
    kb = get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")
    if kb.get("repo_type") != "svn":
        raise HTTPException(400, "知识库不是 SVN 类型")

    username = data.get("username", "")
    password = data.get("password", "")
    save_creds = data.get("save_credentials", False)

    if save_creds:
        update_kb_credentials(kb_id, username, password)

    # Create a new sync task that will use the stored credentials
    from backend.stores.task import create_task
    task = create_task("sync_repo", kb_id=kb_id, params={"kb_id": kb_id})

    return {"ok": True, "task_id": task["id"]}
```

- [ ] **Step 5: Add `svn_sync` import at top of `main.py`**

```python
from backend.sync import git_sync, svn_sync
```

- [ ] **Step 6: Commit**

```bash
cd /home/long2015/Code/OpenCodeWiki
git add backend/main.py
git commit -m "feat(api): extend KB API for SVN credentials and svn-auth endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 5: 前端 SVN 凭证 UI

**Files:**
- Modify: `frontend/src/api/opencodewiki.ts`
- Modify: `frontend/src/pages/SourcesPage.tsx`

**Interfaces:**
- Consumes: Task 4 (POST /api/kb/{kb_id}/svn-auth endpoint)
- Produces: SVN credential input in KB creation form, auth failure dialog

- [ ] **Step 1: Add `submitSVNAuth` API function**

In `frontend/src/api/opencodewiki.ts`, add:
```typescript
export function submitSVNAuth(kbId: string, username: string, password: string, saveCredentials: boolean): Promise<{ task_id: string }> {
  return request(`/api/kb/${kbId}/svn-auth`, {
    method: 'POST',
    body: JSON.stringify({ username, password, save_credentials: saveCredentials }),
  })
}
```

- [ ] **Step 2: In SourcesPage.tsx — add SVN credential fields to creation form**

In the add modal, when `addMode === 'online'` and `repoType === 'svn'`, show credential inputs after the protocol selector:

After line 444 (`</div>` closing the repo fields), add inside the `addUrl.trim()` condition:

```tsx
{repoType === 'svn' && (
  <div className="border-t border-gray-100 pt-3 mt-2 space-y-2.5">
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-10 shrink-0">用户名</span>
      <input value={svnUsername} onChange={e => setSvnUsername(e.target.value)}
        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white font-mono"
        placeholder="可选" />
    </div>
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-10 shrink-0">密码</span>
      <input type="password" value={svnPassword} onChange={e => setSvnPassword(e.target.value)}
        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white font-mono"
        placeholder="可选" />
    </div>
    <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
      <input type="checkbox" checked={svnSaveCreds} onChange={e => setSvnSaveCreds(e.target.checked)}
        className="rounded border-gray-300 text-cyber-blue focus:ring-cyber-blue/20" />
      保存密码到知识库
    </label>
  </div>
)}
```

- [ ] **Step 3: Add state variables for SVN credentials**

Add to the state declarations:
```typescript
const [svnUsername, setSvnUsername] = useState('')
const [svnPassword, setSvnPassword] = useState('')
const [svnSaveCreds, setSvnSaveCreds] = useState(true)
```

- [ ] **Step 4: Pass credentials to createKB**

Update `handleAddSubmit` for online mode — pass svn_username/svn_password to createKB:

```typescript
if (addMode === 'online') {
  const kb = await createKB(name, desc, {
    repo_url: addUrl.trim(), repo_type: repoType,
    repo_branch: repoBranch, content_type: contentType,
    svn_username: svnSaveCreds ? svnUsername : '',
    svn_password: svnSaveCreds ? svnPassword : '',
  })
  await syncKB(kb.id)
  showSuccess(`仓库「${name}」已添加，首轮同步已启动`)
}
```

- [ ] **Step 5: Add SVN auth failure detection + dialog**

Add a `useState` for the auth dialog:
```typescript
const [showAuthDialog, setShowAuthDialog] = useState<{ kbId: string; kbName: string } | null>(null)
const [authUsername, setAuthUsername] = useState('')
const [authPassword, setAuthPassword] = useState('')
const [authSave, setAuthSave] = useState(true)
const [authSubmitting, setAuthSubmitting] = useState(false)
```

In the running tasks polling `useEffect`, add detection:
```typescript
// Detect SVN auth required
for (const t of Array.isArray(tasks) ? tasks : []) {
  if (t.params?.auth_required && t.kb_id && !showAuthDialog) {
    const kb = kbs.find(k => k.id === t.kb_id)
    if (kb && kb.repo_type === 'svn') {
      setShowAuthDialog({ kbId: t.kb_id, kbName: kb.name || '' })
    }
  }
}
```

Add the auth dialog component (before closing `</div>` of the modal overlay):
```tsx
{/* ── SVN 认证弹窗 ── */}
{showAuthDialog && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAuthDialog(null)}>
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
      <h3 className="text-sm font-bold text-gray-900 mb-1">SVN 认证</h3>
      <p className="text-xs text-gray-400 mb-4">{showAuthDialog.kbName} 需要输入密码</p>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">用户名</label>
          <input value={authUsername} onChange={e => setAuthUsername(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">密码</label>
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={authSave} onChange={e => setAuthSave(e.target.checked)}
            className="rounded border-gray-300 text-cyber-blue focus:ring-cyber-blue/20" />
          保存密码到知识库
        </label>
      </div>
      <div className="flex gap-2 justify-end pt-4">
        <button onClick={() => { setShowAuthDialog(null); setAuthUsername(''); setAuthPassword('') }}
          className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
        <button onClick={async () => {
          if (!showAuthDialog) return
          setAuthSubmitting(true)
          try {
            await submitSVNAuth(showAuthDialog.kbId, authUsername, authPassword, authSave)
            showSuccess('认证信息已提交，正在重新同步')
            setShowAuthDialog(null); setAuthUsername(''); setAuthPassword('')
          } catch (e: any) {
            showError(`认证失败: ${e.message || '未知错误'}`)
          }
          setAuthSubmitting(false)
        }} disabled={authSubmitting || !authUsername.trim()}
          className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
          {authSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          提交并重试
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Import `submitSVNAuth` at the top of SourcesPage.tsx**

Update the import from `@/api/opencodewiki`:
```typescript
import { fetchKBs, createKB, deleteKB, fetchDocuments, uploadDocument, deleteDocument, syncKB, submitSVNAuth } from '@/api/opencodewiki'
```

- [ ] **Step 7: Commit**

```bash
cd /home/long2015/Code/OpenCodeWiki
git add frontend/src/api/opencodewiki.ts frontend/src/pages/SourcesPage.tsx
git commit -m "feat(ui): add SVN credential input and auth failure dialog

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 6: 端到端验证

**Files:** None (manual verification)

- [ ] **Step 1: Update Dockerfile to include subversion**

In Dockerfile, add `subversion` to the apt-get install line:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    git subversion \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Build frontend and verify TypeScript compilation**

Run: `cd /home/long2015/Code/OpenCodeWiki/frontend && npx tsc --noEmit`

Expected: no type errors

- [ ] **Step 4: Run all backend tests**

Run: `cd /home/long2015/Code/OpenCodeWiki/backend && python -m pytest tests/ -v`

Expected: all tests pass

- [ ] **Step 5: Verify server starts**

Run: `cd /home/long2015/Code/OpenCodeWiki/backend && timeout 5 python -c "from backend.main import app; print('Server app created OK')" 2>&1 || true`

Expected: "Server app created OK"
