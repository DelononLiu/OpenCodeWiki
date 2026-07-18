# Task 3 Report: main.py 新增 API 端点

## Status

Completed.

## Commits

```
e40ef1b feat: main.py 新增 6 个 sources API 端点 + 路由测试
```

## Changes

### `backend/main.py`
- **Imports**: Added `stores.sources` (aliased `get_sources`, `get_source_entry`) and `source_importer` (6 async functions) imports.
- **`_load_registry()`**: Replaced direct JSON file read with delegation to `stores.sources.list_sources()`. Preserves `REGISTRY_PATH` constant for `agent/tools.py` compat.
- **`/api/repos`**: Changed from `_load_registry()` to `get_sources("code")` for backward compatibility (returns only code-type sources).
- **6 new endpoints** added after `/api/repos`:
  - `GET /api/sources` -- list sources, optional `?type=` filter
  - `GET /api/sources/{name}` -- get single source (404 if not found)
  - `POST /api/sources` -- create source from Git URL (code/docs)
  - `POST /api/sources/upload` -- upload zip file source
  - `POST /api/sources/{name}/sync` -- sync existing source
  - `DELETE /api/sources/{name}` -- remove source

### `backend/tests/test_main/test_sources_routes.py`
- 23 test cases covering all new endpoints:
  - 4 listing tests (empty, all, filter code, filter docs)
  - 2 get-source tests (found, not-found 404)
  - 6 create-source tests (code-git, docs-git, missing name, duplicate, invalid type, runtime error)
  - 6 upload tests (code-zip, docs-zip, missing name / 422, duplicate, invalid type, import exception)
  - 3 sync tests (success, not-found 404, runtime error)
  - 2 delete tests (success, not-found 404)
  - 1 backward-compat test (`/api/repos`)
- All tests follow `test_settings_routes.py` patterns (mock `stores.sources.REGISTRY_PATH` for list/get, mock `main.*` async functions for create/sync/delete/upload).

## Test Summary

```
=== 153 passed in 4.47s ===
```

All existing tests (130) continue to pass. All 23 new tests pass.

## Concerns

- `POST /api/sources/upload`: When `name` is omitted from the multipart form, FastAPI's `Form(...)` validation rejects with HTTP 422 before the handler runs -- the `if not name` guard in the handler is never reached. This is correct FastAPI behavior; the test asserts a 422 response.
- The `import_code_git`, `import_code_zip`, etc. functions require real git/zip tools at runtime. Tests mock these entirely, so no real I/O occurs during testing.

## Report Path

`/home/long2015/Code/OpenCodeWiki/.superpowers/sdd/task-3-report.md`
