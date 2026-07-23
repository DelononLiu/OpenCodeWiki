import os
from backend.config import Config
from backend.stores.repo import get_repo, update_sync_status
from backend.stores.doc import create_document, list_documents
from backend.stores.task import get_task, update_task_status
from backend.knowledge.importer import import_document, compute_hash
from backend.sync import git_sync
from backend.task_worker.plugins.base import TaskPlugin, TaskEvent, TaskCancelledError


def _is_cancelled(task_id: str) -> bool:
    t = get_task(task_id)
    return t is None or t["status"] == "cancelled"


class SyncRepoPlugin(TaskPlugin):
    task_type = "sync_repo"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    async def process(self, event: TaskEvent) -> TaskEvent:
        repo_id = event.params.get("repo_id")
        if not repo_id:
            raise ValueError("Missing repo_id in params")

        repo = get_repo(repo_id)
        if not repo:
            raise ValueError(f"Repo not found: {repo_id}")

        update_task_status(event.task_id, "running", progress=5,
                           progress_msg=f"正在同步 {repo['url']}")

        # 1. Clone or pull
        if os.path.isdir(repo["local_path"]):
            changed = await git_sync.pull(repo["local_path"])
        else:
            await git_sync.clone(repo["url"], repo["local_path"], repo["branch"])
            changed = []  # all files are new

        if _is_cancelled(event.task_id):
            raise TaskCancelledError()

        update_task_status(event.task_id, "running", progress=20,
                           progress_msg="正在扫描文件变化")

        # 2. Scan local files and compare with DB
        local_files = await git_sync.list_files(repo["local_path"])
        existing = list_documents(repo["kb_id"])
        existing_by_path: dict[str, dict] = {}
        for doc in existing:
            # Store the relative path in metadata for comparison
            rel_path = doc.get("title", "")
            existing_by_path[rel_path] = doc

        # 3. Diff: new / changed / deleted
        new_or_changed = []
        for rel_path, sha in local_files.items():
            if rel_path in existing_by_path:
                if existing_by_path[rel_path].get("file_hash") != sha:
                    new_or_changed.append(rel_path)
            else:
                new_or_changed.append(rel_path)

        deleted = [p for p in existing_by_path if p not in local_files]

        total = len(new_or_changed) + len(deleted)
        done = 0

        async def on_progress(pct: int, msg: str):
            update_task_status(event.task_id, "running",
                               progress=max(20, min(90, 20 + int(pct * 0.7))),
                               progress_msg=msg)

        # 4. Import new/changed files
        for rel_path in new_or_changed:
            if _is_cancelled(event.task_id):
                raise TaskCancelledError()

            full_path = os.path.join(repo["local_path"], rel_path)
            file_hash = compute_hash(full_path)
            ext = os.path.splitext(rel_path)[1].lstrip(".").lower()

            # Delete existing doc first if re-importing
            if rel_path in existing_by_path:
                from backend.stores.doc import delete_document
                delete_document(existing_by_path[rel_path]["id"])
                from backend.knowledge.vector_store import delete_by_doc_id
                delete_by_doc_id(existing_by_path[rel_path]["id"])

            doc = create_document(repo["kb_id"], rel_path, full_path, file_hash, ext)
            await import_document(
                doc["id"], full_path, repo["kb_id"], self.cfg,
                progress_callback=on_progress,
                cancel_check=lambda: _is_cancelled(event.task_id),
            )

            done += 1
            pct = int(done / max(total, 1) * 100)
            update_task_status(event.task_id, "running", progress=min(90, pct),
                               progress_msg=f"已导入 {rel_path}")

        # 5. Handle deleted files
        for rel_path in deleted:
            if _is_cancelled(event.task_id):
                raise TaskCancelledError()
            doc = existing_by_path[rel_path]
            from backend.stores.doc import delete_document
            from backend.knowledge.vector_store import delete_by_doc_id
            delete_by_doc_id(doc["id"])
            delete_document(doc["id"])
            done += 1
            pct = int(done / max(total, 1) * 100)
            update_task_status(event.task_id, "running", progress=min(90, pct),
                               progress_msg=f"已移除 {rel_path}")

        # 6. Update repo last sync time
        update_sync_status(repo_id, "success")

        return event
