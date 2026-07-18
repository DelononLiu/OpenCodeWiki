# 统一知识源管理系统 — 实施计划

> For agentic workers: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** 实现统一知识源管理系统后端，支持代码源和文档源的注册、导入、同步、删除

**Architecture:** 新增 `stores/sources.py` 集中管理 registry，`source_importer.py` 处理导入流程，`main.py` 新增 6 个 API 端点

**Tech Stack:** Python FastAPI, sqlite3, asyncio.subprocess, git CLI, zipfile

## Global Constraints

- 遵循现有 `stores/*.py` 的数据访问层模式
- API 响应格式一致：`{ok: bool, data?: any, error?: string}`
- 所有文件路径操作使用 `pathlib.Path`
- registry 存储在 `~/.opencodewiki/registry.json`
- openwiki CLI 通过 subprocess 调用
- 旧 registry 清空重建，不兼容历史

---

### Task 1: 新增 stores/sources.py

**Files:**
- Create: `backend/stores/sources.py`
- Test: `backend/tests/test_stores/test_sources.py`

**Interfaces:**
- Produces: `list_sources(type)`, `get_source(name)`, `create_source(data)`, `delete_source(name)`, `update_source(name, data)`

- [ ] **Step 1: 写测试**

```python
# tests/test_stores/test_sources.py
def test_list_empty(tmp_path):
    reg = tmp_path / "registry.json"
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        from stores.sources import list_sources
        assert list_sources() == []

def test_create_and_list(tmp_path):
    reg = tmp_path / "registry.json"
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        from stores.sources import create_source, list_sources, get_source
        result = create_source({"name": "test", "type": "code", "url": "git@..."})
        assert result["name"] == "test"
        assert len(list_sources()) == 1
        assert get_source("test")["type"] == "code"

def test_get_nonexistent(tmp_path):
    reg = tmp_path / "registry.json"
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        from stores.sources import get_source
        assert get_source("nope") is None

def test_delete_source(tmp_path):
    reg = tmp_path / "registry.json"
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        from stores.sources import create_source, delete_source, list_sources
        create_source({"name": "del-me", "type": "code"})
        assert delete_source("del-me") is True
        assert len(list_sources()) == 0
        assert delete_source("nope") is False

def test_list_by_type(tmp_path):
    reg = tmp_path / "registry.json"
    reg.write_text("[]")
    with patch("stores.sources.REGISTRY_PATH", reg):
        from stores.sources import create_source, list_sources
        create_source({"name": "code-a", "type": "code"})
        create_source({"name": "docs-b", "type": "docs"})
        assert len(list_sources("code")) == 1
        assert len(list_sources("docs")) == 1
        assert len(list_sources()) == 2
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_stores/test_sources.py -v
```

- [ ] **Step 3: 写实现**

```python
# stores/sources.py
import json
from datetime import datetime, timezone
from pathlib import Path

REGISTRY_PATH = Path.home() / ".opencodewiki" / "registry.json"
OPENER_CODE_DIR = Path.home() / ".opencodewiki" / "repos"
OPENER_PAGES_SOURCES = Path.home() / ".opencodewiki" / "pages" / "sources"
OPENER_VECTORS_DIR = Path.home() / ".opencodewiki" / "vectors"


def _read() -> list[dict]:
    try:
        return json.loads(REGISTRY_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write(data: list[dict]):
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def list_sources(type: str | None = None) -> list[dict]:
    sources = _read()
    if type:
        return [s for s in sources if s.get("type") == type]
    return sources


def get_source(name: str) -> dict | None:
    for s in _read():
        if s["name"] == name:
            return s
    return None


def create_source(data: dict) -> dict:
    sources = _read()
    now = datetime.now(timezone.utc).isoformat()
    entry = {"name": data["name"], "type": data.get("type", "code")}
    if data.get("url"):
        entry["url"] = data["url"]
    entry["created_at"] = now
    entry["updated_at"] = now
    sources.append(entry)
    _write(sources)
    return entry


def delete_source(name: str) -> bool:
    sources = _read()
    for i, s in enumerate(sources):
        if s["name"] == name:
            sources.pop(i)
            _write(sources)
            return True
    return False


def update_source(name: str, data: dict) -> dict | None:
    sources = _read()
    for s in sources:
        if s["name"] == name:
            s.update(data)
            _write(sources)
            return s
    return None
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

---

### Task 2: 导入流程核心模块 source_importer.py

**Files:**
- Create: `backend/source_importer.py`

- [ ] **Step 1: 写实现**

```python
# source_importer.py
import asyncio
import json
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from stores.sources import (
    OPENER_CODE_DIR, OPENER_PAGES_SOURCES, OPENER_VECTORS_DIR,
    create_source, delete_source as delete_registry_entry,
    get_source, update_source,
)

OPENWIKI_CLI = "openwiki"


async def _run_cmd(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=cwd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, (stdout or b"").decode() + (stderr or b"").decode()


async def _git_clone(url: str, dest: Path):
    code, log = await _run_cmd(["git", "clone", url, str(dest)])
    if code != 0:
        raise RuntimeError(f"git clone 失败: {log[:200]}")


async def _unzip(zip_path: Path, dest: Path):
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)


def _scan_md(root: Path) -> list[Path]:
    return sorted(root.rglob("*.md"))


async def _copy_md_files(src: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    for md in _scan_md(src):
        rel = md.relative_to(src)
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(md.read_text(encoding="utf-8"), encoding="utf-8")


async def import_code_git(name: str, url: str) -> dict:
    dest = OPENER_CODE_DIR / name
    await _git_clone(url, dest)
    from agent.tools import BINARY
    await _run_cmd([BINARY, "cli", "index", json.dumps({"path": str(dest)})])
    wiki_dir = dest / "opencodewiki"
    wiki_dir.mkdir(parents=True, exist_ok=True)
    await _run_cmd([OPENWIKI_CLI, str(dest)], cwd=dest)
    return create_source({"name": name, "type": "code", "url": url})


async def import_code_zip(name: str, zip_path: Path) -> dict:
    dest = OPENER_CODE_DIR / name
    dest.mkdir(parents=True, exist_ok=True)
    await _unzip(zip_path, dest)
    wiki_dir = dest / "opencodewiki"
    wiki_dir.mkdir(parents=True, exist_ok=True)
    await _run_cmd([OPENWIKI_CLI, str(dest)], cwd=dest)
    return create_source({"name": name, "type": "code"})


async def import_docs_git(name: str, url: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        clone_dir = Path(tmp) / name
        await _git_clone(url, clone_dir)
        await _copy_md_files(clone_dir, OPENER_PAGES_SOURCES / name)
    return create_source({"name": name, "type": "docs", "url": url})


async def import_docs_zip(name: str, zip_path: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        extract_dir = Path(tmp) / name
        await _unzip(zip_path, extract_dir)
        await _copy_md_files(extract_dir, OPENER_PAGES_SOURCES / name)
    return create_source({"name": name, "type": "docs"})


async def sync_source(name: str) -> dict:
    source = get_source(name)
    if not source:
        raise ValueError(f"Source '{name}' not found")
    now = datetime.now(timezone.utc).isoformat()
    if source["type"] == "code":
        repo_path = OPENER_CODE_DIR / name
        await _run_cmd(["git", "pull"], cwd=repo_path)
        await _run_cmd([OPENWIKI_CLI, str(repo_path)], cwd=repo_path)
    elif source["type"] == "docs":
        with tempfile.TemporaryDirectory() as tmp:
            clone_dir = Path(tmp) / name
            await _git_clone(source["url"], clone_dir)
            dest = OPENER_PAGES_SOURCES / name
            if dest.exists():
                shutil.rmtree(dest)
            await _copy_md_files(clone_dir, dest)
    update_source(name, {"updated_at": now})
    return get_source(name)


async def remove_source(name: str) -> bool:
    source = get_source(name)
    if not source:
        return False
    if source["type"] == "code":
        repo_path = OPENER_CODE_DIR / name
        if repo_path.exists():
            shutil.rmtree(repo_path)
    elif source["type"] == "docs":
        pages_path = OPENER_PAGES_SOURCES / name
        if pages_path.exists():
            shutil.rmtree(pages_path)
    for vec_file in OPENER_VECTORS_DIR.glob(f"{name}.vec.db*"):
        vec_file.unlink(missing_ok=True)
    return delete_registry_entry(name)
```

- [ ] **Step 2: 提交**

---

### Task 3: main.py 新增 API 端点

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: 追加导入和路由**

在顶部 import 追加：

```python
from stores.sources import (
    list_sources as get_sources,
    get_source as get_source_entry,
)
from source_importer import (
    import_code_git, import_code_zip,
    import_docs_git, import_docs_zip,
    sync_source, remove_source,
)
```

替换 `/api/repos` 路由和第 40-44 行的 `_load_registry` 函数。在 `/api/repos` 路由之后追加新端点：

```python
@app.get("/api/sources")
async def api_sources(type: str | None = None):
    return _ok(get_sources(type))

@app.get("/api/sources/{name}")
async def api_source(name: str):
    src = get_source_entry(name)
    if not src:
        raise HTTPException(404, f"Source '{name}' not found")
    return _ok(src)

@app.post("/api/sources")
async def api_create_source(body: dict):
    name = (body.get("name") or "").strip()
    url = (body.get("url") or "").strip()
    source_type = body.get("type", "code")
    if not name:
        return _err("Missing name")
    if get_source_entry(name):
        return _err(f"Source '{name}' already exists")
    try:
        if source_type == "code":
            result = await import_code_git(name, url)
        elif source_type == "docs":
            result = await import_docs_git(name, url)
        else:
            return _err(f"Invalid type: {source_type}")
        return _ok(result)
    except RuntimeError as e:
        return _err(str(e), 500)

@app.post("/api/sources/upload")
async def api_upload_source(name: str = Form(...), type: str = Form("code"), file: UploadFile = File(...)):
    if not name:
        return _err("Missing name")
    if get_source_entry(name):
        return _err(f"Source '{name}' already exists")
    zip_path = Path.home() / ".opencodewiki" / "tmp" / f"{name}.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    zip_path.write_bytes(content)
    try:
        if type == "code":
            result = await import_code_zip(name, zip_path)
        elif type == "docs":
            result = await import_docs_zip(name, zip_path)
        else:
            return _err(f"Invalid type: {type}")
        return _ok(result)
    except Exception as e:
        return _err(str(e), 500)
    finally:
        zip_path.unlink(missing_ok=True)

@app.post("/api/sources/{name}/sync")
async def api_sync_source(name: str):
    try:
        result = await sync_source(name)
        return _ok(result)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        return _err(str(e), 500)

@app.delete("/api/sources/{name}")
async def api_delete_source(name: str):
    ok = await remove_source(name)
    if not ok:
        raise HTTPException(404, f"Source '{name}' not found")
    return _ok({"deleted": True})
```

保留旧的 `/api/repos` 向后兼容：

```python
@app.get("/api/repos")
async def api_repos():
    return _ok(get_sources("code"))
```

- [ ] **Step 2: 提交**

---

### Task 4: 测试导入流程

**Files:**
- Create: `backend/tests/test_source_importer.py`

- [ ] **Step 1: 写测试**

```python
@pytest.fixture
def mock_env(tmp_path):
    with patch("stores.sources.REGISTRY_PATH", tmp_path / "registry.json"):
        with patch("source_importer.OPENER_CODE_DIR", tmp_path / "repos"):
            with patch("source_importer.OPENER_PAGES_SOURCES", tmp_path / "sources"):
                with patch("source_importer.OPENER_VECTORS_DIR", tmp_path / "vectors"):
                    (tmp_path / "vectors").mkdir()
                    yield

def test_import_code_git(mock_env):
    from source_importer import import_code_git, OPENER_CODE_DIR
    ...
```

- [ ] **Step 2: 提交**

---

### Task 5: 全量测试验证

- [ ] **Step 1: 运行全部后端测试**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/ -v
```

- [ ] **Step 2: 修复失败**

- [ ] **Step 3: 最终提交**
