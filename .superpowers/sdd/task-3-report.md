# Task 3 Report: SyncRepoPlugin SVN dispatch

**Status:** DONE

## Changes Made

### `backend/task_worker/plugins/sync_repo.py`
- Added `from backend.sync import svn_sync` import
- Added SVN credential extraction (`svn_username`, `svn_password`) from KB config
- Replaced the clone/pull block with SVN-aware dispatch (`is_svn = kb.get("repo_type") == "svn"`)
  - SVN path: calls `svn_sync.update()` or `svn_sync.checkout()`, catches `SVNAuthError` and sets `params={"auth_required": True}` on the task
  - Git path: unchanged behavior via `git_sync`
- Replaced the save-repo-version block to dispatch between `svn_sync.get_revision()` and `git_sync.get_head_commit()`

### `backend/stores/task.py`
- Added `params: dict | None = None` parameter to `update_task_status()`, serializes to JSON if provided
- `get_task()`: parses `params` column from JSON string to dict via `json.loads()`
- `list_tasks()`: same params parsing fix
- `create_task()`: returns `params or {}` instead of raw JSON string

## Commit

```
1a8b075 feat(sync): SyncRepoPlugin dispatches SVN operations, handles auth errors
```

## Smoke Tests

- `from backend.task_worker.plugins.sync_repo import SyncRepoPlugin` -- OK
- `from backend.stores.task import update_task_status, get_task, list_tasks` -- OK

## Concerns

- Line 118 still calls `git_sync.list_files(scan_dir)` unconditionally. For SVN repos, this may fail if `git_sync.list_files` relies on git-specific logic rather than being a pure directory-walk helper. The task brief explicitly stated "no changes needed" for the scan_dir logic, so this was left as-is. If issues arise with SVN file scanning, `svn_sync.list_files()` can be substituted in a follow-up.
