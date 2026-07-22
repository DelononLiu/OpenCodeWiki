"""
Event-driven Pipeline engine inspired by WeKnora's EventManager.

Plugins register on specific event types. Multiple plugins can subscribe to
the same event — they run sequentially in registration order.

Example:
    pipeline = Pipeline()
    pipeline.on(Event.QUERY_UNDERSTAND, IntentPlugin(...))
    pipeline.on(Event.QUERY_UNDERSTAND, RewritePlugin(...))
    pipeline.on(Event.SEARCH, SearchPlugin(...))
    pipeline.on(Event.SEARCH, ExpandContextPlugin(...))  # same event, extra strategy
    pipeline.on(Event.CHAT_COMPLETE, ChatPlugin(...))
"""

from abc import ABC, abstractmethod
from backend.pipeline.events import PipelineEvent, EventNames


class BasePlugin(ABC):
    """A plugin that processes some stage(s) of the pipeline."""

    @abstractmethod
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        """Transform the event. Called by the pipeline when the plugin's event fires."""
        ...

    def events(self) -> list[str]:
        """Which events this plugin subscribes to. Override to narrow.
        Default: subscribes to ALL events (runs on every stage)."""
        return EventNames.ORDER


class Pipeline:
    """
    Event-driven plugin pipeline.

    Plugins register on named events via on(). When run(), the pipeline
    fires events in the order defined by EventNames.ORDER. At each event,
    every plugin subscribed to that event processes the event in turn.

    Usage:
        pipeline = Pipeline()
        pipeline.on(EventNames.QUERY_UNDERSTAND, QueryUnderstandPlugin(...))
        pipeline.on(EventNames.SEARCH, SearchPlugin(...))
        pipeline.on(EventNames.SEARCH, NeighborExpandPlugin(...))  # extra strategy!
        pipeline.on(EventNames.CHAT_COMPLETE, ChatPlugin(...))
        result = await pipeline.run(event)
    """

    def __init__(self):
        self._handlers: dict[str, list[BasePlugin]] = {
            name: [] for name in EventNames.ORDER
        }

    def on(self, event_name: str, plugin: BasePlugin) -> "Pipeline":
        """Register a plugin to run when `event_name` fires.
        Returns self for chaining."""
        self._handlers[event_name].append(plugin)
        return self

    async def run(self, event: PipelineEvent, *,
                  until: str | None = None) -> PipelineEvent:
        """Execute the pipeline. Pass `until` to stop after a specific event.
        e.g. `await pipeline.run(event, until=EventNames.SEARCH)` stops after search."""
        for event_name in EventNames.ORDER:
            if event_name not in self._handlers:
                continue
            for plugin in self._handlers[event_name]:
                event = await plugin.process(event)
            if until and event_name == until:
                break
        return event
