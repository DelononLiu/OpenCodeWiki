import asyncio
import os
from backend.config import Config
from backend.stores.kb import get_kb
from backend.stores.doc import create_document, list_documents
from backend.stores.task import get_task, update_task_status
from backend.knowledge.importer import import_document, compute_hash
from backend.sync import git_sync
from backend.task_worker.plugins.base import TaskPlugin, TaskEvent, TaskCancelledError


def _extract_title(filepath: str) -> str:
    """Read first # heading from markdown file as title."""
    try:
        with open(filepath, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("# ") and not line.startswith("##"):
                    return line[2:].strip()
    except Exception:
        pass
    return ""


class SyncRepoPlugin(TaskPlugin):
    task_type = "sync_repo"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    async def process(self, event: TaskEvent) -> TaskEvent:
        kb_id = event.params.get("kb_id")
        if not kb_id:
            raise ValueError("Missing kb_id in params")

        kb = get_kb(kb_id)
        if not kb:
            raise ValueError(f"Knowledge base not found: {kb_id}")
        if not kb.get("repo_url"):
            raise ValueError(f"Knowledge base '{kb['name']}' has no remote repo")

        local_path = os.path.join(os.path.expanduser(self.cfg.database.path), "knowledge", kb["name"])
        repo_url = kb["repo_url"]
        repo_branch = kb.get("repo_branch") or "main"

        update_task_status(event.task_id, "running", progress=5,
                           progress_msg=f"正在同步 {repo_url}")

        # 1. Clone or pull
        if os.path.isdir(local_path):
            await git_sync.pull(local_path)
        else:
            os.makedirs(local_path, exist_ok=True)
            await git_sync.clone(repo_url, local_path, repo_branch)

        def _cancelled():
            t = get_task(event.task_id)
            return t is None or t["status"] == "cancelled"

        if _cancelled():
            raise TaskCancelledError()

        # 2. For code repos: use existing openwiki/ or generate it
        scan_dir = local_path
        if kb.get("content_type") == "code":
            ow_dir = os.path.join(local_path, "openwiki")
            if os.path.isdir(ow_dir):
                scan_dir = ow_dir  # already has openwiki
            else:
                update_task_status(event.task_id, "running", progress=20,
                                   progress_msg="正在从代码生成文档...")
                proc = await asyncio.create_subprocess_exec(
                    "openwiki", local_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc.wait()
                scan_dir = ow_dir if os.path.isdir(ow_dir) else local_path
        else:
            scan_dir = local_path

        if _cancelled():
            raise TaskCancelledError()

        update_task_status(event.task_id, "running", progress=30,
                           progress_msg="正在扫描文件变化")

        # 3. Scan files
        local_files = await git_sync.list_files(scan_dir)
        existing = list_documents(kb_id)
        existing_by_path: dict[str, dict] = {}
        for doc in existing:
            existing_by_path[doc["title"]] = doc

        # 4. Diff
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
                               progress=max(30, min(90, 30 + int(pct * 0.6))),
                               progress_msg=msg)

        # 5. Import new/changed files
        for rel_path in new_or_changed:
            if _cancelled():
                raise TaskCancelledError()

            full_path = os.path.join(scan_dir, rel_path)
            file_hash = compute_hash(full_path)
            ext = os.path.splitext(rel_path)[1].lstrip(".").lower()

            if rel_path in existing_by_path:
                from backend.stores.doc import delete_document
                delete_document(existing_by_path[rel_path]["id"])
                from backend.knowledge.vector_store import delete_by_doc_id
                delete_by_doc_id(existing_by_path[rel_path]["id"])

            doc = create_document(kb_id, rel_path, full_path, file_hash, ext)
            await import_document(
                doc["id"], full_path, kb_id, self.cfg,
                progress_callback=on_progress,
                cancel_check=_cancelled,
            )

            done += 1
            pct = int(done / max(total, 1) * 100)
            update_task_status(event.task_id, "running", progress=min(90, pct),
                               progress_msg=f"已导入 {rel_path}")

        # 6. Handle deleted files
        for rel_path in deleted:
            if _cancelled():
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

        # 7. Save repo version (git commit hash)
        from backend.database import get_knora_db
        try:
            ver = await git_sync.get_head_commit(local_path)
            if ver:
                db = get_knora_db()
                db.execute("UPDATE knowledge_bases SET repo_version = ? WHERE id = ?", (ver, kb_id))
                db.commit()
        except Exception:
            pass

        # 8. Refresh wiki module cache so pages show immediately
        import json
        wiki_root = scan_dir if kb.get("content_type") == "code" else local_path
        # Recursively collect all .md files, extract first # heading as title
        entries = []
        for root, _dirs, names in os.walk(wiki_root):
            for n in sorted(names):
                if n.endswith(".md"):
                    rel = os.path.relpath(os.path.join(root, n), wiki_root)
                    slug = rel.replace(".md", "").replace(os.sep, "/")
                    title = _extract_title(os.path.join(root, n)) or slug
                    entries.append({"slug": slug, "title": title})
        # Write to both root (where wiki API reads) and openwiki/ subdir
        for d in (local_path, scan_dir):
            try:
                if os.path.isdir(d):
                    with open(os.path.join(d, ".wiki_modules.json"), "w") as f:
                        json.dump(entries, f)
            except Exception:
                pass

        update_task_status(event.task_id, "running", progress=100,
                           progress_msg="同步完成")
        return event
