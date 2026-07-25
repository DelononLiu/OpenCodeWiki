import asyncio
import json
import logging
from backend.config import Config
from backend.stores.task import claim_next_pending, get_task, update_task_status
from backend.task_worker.plugins.base import TaskEvent, TaskCancelledError, TaskPlugin

logger = logging.getLogger(__name__)


class TaskWorker:
    """
    Background task worker that polls SQLite for pending tasks and
    dispatches to registered TaskPlugins.

    Usage:
        worker = TaskWorker(cfg)
        worker.on('rebuild', RebuildPlugin(cfg))
        asyncio.create_task(worker.run())
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._running = False
        self._plugins: dict[str, TaskPlugin] = {}

    def on(self, task_type: str, plugin: TaskPlugin) -> "TaskWorker":
        """Register a plugin for the given task type. Chainable."""
        self._plugins[task_type] = plugin
        return self

    async def run(self):
        """Main polling loop — call with asyncio.create_task()."""
        self._running = True
        while self._running:
            try:
                task = claim_next_pending()
                if task:
                    asyncio.create_task(self._execute(task))
            except Exception as e:
                logger.error("[TaskWorker] poll error: %s", e)
            await asyncio.sleep(2)

    def stop(self):
        self._running = False

    async def _execute(self, task: dict) -> None:
        plugin = self._plugins.get(task["type"])
        task_id = task["id"]

        if not plugin:
            update_task_status(task_id, "failed", error_message=f"No plugin registered for type '{task['type']}'")
            return

        event = TaskEvent(
            task_id=task_id,
            task_type=task["type"],
            params=task.get("params", {}),
            progress=task.get("progress", 0),
            progress_msg=task.get("progress_msg", ""),
        )

        try:
            event = await plugin.process(event)
            # Don't overwrite tasks that are pending authentication
            t = get_task(task_id)
            if t and t.get("params", {}).get("auth_required"):
                return
            update_task_status(task_id, "completed", progress=100, progress_msg="完成")
        except TaskCancelledError:
            update_task_status(task_id, "cancelled", progress_msg="已取消")
        except Exception as e:
            logger.exception("[TaskWorker] task %s failed", task_id)
            update_task_status(task_id, "failed", progress=event.progress, error_message=str(e))
