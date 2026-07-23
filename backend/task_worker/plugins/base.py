from pydantic import BaseModel
from backend.pipeline.pipeline import BasePlugin


class TaskEvent(BaseModel):
    """Event object flowing through TaskPlugin chain, analogous to PipelineEvent."""
    task_id: str
    task_type: str
    params: dict = {}
    progress: int = 0
    progress_msg: str = ""
    cancelled: bool = False


class TaskCancelledError(Exception):
    """Raised by a TaskPlugin when it detects cancellation."""
    pass


class TaskPlugin(BasePlugin):
    """
    Base class for task handlers. Inherits from Pipeline's BasePlugin
    so that any TaskPlugin can theoretically also be wired into a Pipeline.

    Subclasses must set task_type and implement process().
    """
    task_type: str = ""

    def events(self) -> list[str]:
        return [self.task_type]

    async def process(self, event: TaskEvent) -> TaskEvent:
        """Override this to handle the task. Raise TaskCancelledError to abort."""
        return event
