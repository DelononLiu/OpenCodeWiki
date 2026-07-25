from backend.config import Config
from backend.stores.kb import list_kbs, get_kb, set_kb_vector_state
from backend.stores.doc import list_documents, update_document_status
from backend.stores.task import get_task, update_task_status
from backend.knowledge.vector_store import delete_by_kb_id
from backend.knowledge.importer import import_document
from backend.task_worker.plugins.base import TaskPlugin, TaskEvent, TaskCancelledError
from backend.stores.doc import delete_chunks_by_kb


def _extract_title(filepath: str) -> str:
    try:
        with open(filepath, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("# ") and not line.startswith("##"):
                    return line[2:].strip()
    except Exception:
        pass
    return ""


class RebuildPlugin(TaskPlugin):
    task_type = "rebuild"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    async def process(self, event: TaskEvent) -> TaskEvent:
        kb_ids = event.params.get("kb_id", [kb["id"] for kb in list_kbs()])
        if isinstance(kb_ids, str):
            kb_ids = [kb_ids]

        total = len(kb_ids)
        done = 0

        def is_cancelled():
            t = get_task(event.task_id)
            return t is None or t["status"] == "cancelled"

        async def on_progress(pct: int, msg: str):
            update_task_status(event.task_id, "running",
                               progress=max(1, min(98, pct)),
                               progress_msg=msg)

        for kb_id in kb_ids:
            if is_cancelled():
                raise TaskCancelledError()

            set_kb_vector_state(kb_id, "rebuilding")

            # Clear existing vectors and chunks for this KB
            delete_by_kb_id(kb_id)
            delete_chunks_by_kb(kb_id)

            docs = list_documents(kb_id)
            doc_total = len(docs)
            for j, doc in enumerate(docs):
                if is_cancelled():
                    raise TaskCancelledError()

                update_document_status(doc["id"], "processing")

                await import_document(
                    doc["id"], doc["file_path"], kb_id, self.cfg,
                    progress_callback=on_progress,
                    cancel_check=is_cancelled,
                    set_ready=False,
                )

                pct = int(((done * doc_total) + (j + 1)) / (total * doc_total or 1) * 100)
                update_task_status(event.task_id, "running", progress=min(pct, 99),
                                   progress_msg=f"{j + 1}/{doc_total} {doc['title']}")

            set_kb_vector_state(kb_id, "ready")
            done += 1

        # Refresh wiki module cache (recursive for nested dirs like docs/)
        import json, os
        for kb_id in kb_ids:
            kb = get_kb(kb_id)
            if not kb:
                continue
            kb_dir = os.path.join(os.path.expanduser(self.cfg.database.path), "knowledge", kb["name"])
            if os.path.isdir(kb_dir):
                entries = []
                for root, _dirs, names in os.walk(kb_dir):
                    for n in sorted(names):
                        if n.endswith(".md"):
                            rel = os.path.relpath(os.path.join(root, n), kb_dir)
                            slug = rel.replace(".md", "").replace(os.sep, "/")
                            title = _extract_title(os.path.join(root, n)) or slug
                            entries.append({"slug": slug, "title": title})
                try:
                    with open(os.path.join(kb_dir, ".wiki_modules.json"), "w") as f:
                        json.dump(entries, f)
                except Exception:
                    pass

        return event
