"""
Event-driven Pipeline engine inspired by WeKnora's EventManager.

Three core capabilities:
1. PipelinePlan — dynamic assembly with AddIf() for conditional stages
2. Parallel execution — plugins on the same event can run via asyncio.gather
3. Middleware chain — plugins can wrap downstream via optional next() callback

Usage:
    plan = PipelinePlan()
    plan.add(EventNames.QUERY_UNDERSTAND)
    plan.add(EventNames.SEARCH, parallel=True)          # concurrent plugins
    plan.add_if(cfg.web_enabled, EventNames.WEB_SEARCH) # conditional
    plan.add(EventNames.CHAT_COMPLETE)

    pipeline = Pipeline(plan)
    pipeline.on(EventNames.SEARCH, SearchPlugin(...))
    pipeline.on(EventNames.SEARCH, ExpandPlugin(...))   # same event, sequential
    pipeline.on(EventNames.SEARCH, WebPlugin(...), parallel=True)  # runs in parallel
    result = await pipeline.run(event, until=EventNames.CONTEXT_BUILD)
"""

import asyncio
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Awaitable
from dataclasses import dataclass
from backend.pipeline.events import PipelineEvent, EventNames


# ── PipelinePlan: dynamic stage ordering with conditional inclusion ──


class PipelinePlan:
    """
    Declares which events fire and in what order.

    Usage:
        plan = PipelinePlan()
        plan.add(EventNames.QUERY_UNDERSTAND)
        plan.add(EventNames.SEARCH)
        plan.add_if(cfg.rerank_enabled, EventNames.RERANK)
        plan.add(EventNames.CHAT_COMPLETE)

    Built-in default: PipelinePlan.default() returns the standard 5-stage plan.
    """
    def __init__(self):
        self._stages: list[str] = []

    def add(self, *event_names: str) -> "PipelinePlan":
        self._stages.extend(event_names)
        return self

    def add_if(self, condition: bool, *event_names: str) -> "PipelinePlan":
        if condition:
            self._stages.extend(event_names)
        return self

    @property
    def stages(self) -> list[str]:
        return list(self._stages)

    @classmethod
    def default(cls) -> "PipelinePlan":
        """Standard 5-stage RAG pipeline."""
        return (cls()
            .add(EventNames.QUERY_UNDERSTAND)
            .add(EventNames.SEARCH)
            .add(EventNames.RERANK)
            .add(EventNames.CONTEXT_BUILD)
            .add(EventNames.CHAT_COMPLETE))


# ── Plugin interfaces ──

NextFunc = Callable[[PipelineEvent], Awaitable[PipelineEvent]]


class BasePlugin(ABC):
    """
    Plugin that transforms a PipelineEvent.

    Two modes (auto-detected via signature inspection):
    - Simple:  async process(event) -> event
    - Middleware: async process(event, next) -> event  (can call next(event) to chain)

    Plugins declare which events they handle via events().
    Default: subscribes to ALL events (runs on every stage).
    """

    @abstractmethod
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        ...

    def events(self) -> list[str]:
        return EventNames.ORDER


# ── Plugin registration entry ──

@dataclass
class _PluginEntry:
    plugin: BasePlugin
    parallel: bool = False


# ── Pipeline ──

class Pipeline:
    """
    Event-driven pipeline with parallel execution and middleware support.

    Plugins are registered per event via on(). Building a PipelinePlan is
    optional — if omitted, uses PipelinePlan.default().

    Usage:
        pipeline = Pipeline()
        pipeline.on(EventNames.QUERY_UNDERSTAND, QueryUnderstandPlugin(...))
        pipeline.on(EventNames.SEARCH, SearchPlugin(...))
        pipeline.on(EventNames.SEARCH, ExpandPlugin(...))  # sequential
        pipeline.on(EventNames.SEARCH, WebPlugin(...), parallel=True)  # concurrent
        result = await pipeline.run(event, until=EventNames.CONTEXT_BUILD)
    """

    def __init__(self, plan: PipelinePlan | None = None):
        self._plan = plan or PipelinePlan.default()
        self._entries: dict[str, list[_PluginEntry]] = {
            name: [] for name in EventNames.ORDER
        }
        self.timings: dict[str, float] = {}  # stage_name → duration_ms

    def on(self, event_name: str, plugin: BasePlugin,
           *, parallel: bool = False) -> "Pipeline":
        """Register a plugin for `event_name`. Set parallel=True to run
        concurrently with other parallel plugins on the same event."""
        self._entries.setdefault(event_name, []).append(
            _PluginEntry(plugin, parallel=parallel))
        return self

    @property
    def plan(self) -> PipelinePlan:
        return self._plan

    async def run(self, event: PipelineEvent, *,
                  until: str | None = None) -> PipelineEvent:
        """
        Execute the pipeline plan. Fires each stage in plan order.
        Within each stage:
          - Sequential plugins run in registration order (each passes event to next).
          - Parallel plugins run via asyncio.gather, each on its own event copy.
        Pass `until` to stop after a specific stage completes.
        """
        for stage_name in self._plan.stages:
            entries = self._entries.get(stage_name, [])

            if not entries:
                if until and stage_name == until:
                    break
                # Record zero timing for empty stages so callers see the stage existed
                if stage_name not in self.timings:
                    self.timings[stage_name] = 0
                continue

            t0 = time.monotonic()

            # Split into sequential and parallel groups
            seq_entries = [e for e in entries if not e.parallel]
            par_entries = [e for e in entries if e.parallel]

            # 1. Run sequential plugins as a middleware chain
            if seq_entries:
                event = await self._run_chain(event, seq_entries)

            # 2. Run parallel plugins concurrently
            if par_entries:
                par_results = await asyncio.gather(
                    *[self._run_chain(event.model_copy(), [pe])
                      for pe in par_entries],
                    return_exceptions=True,
                )
                # Merge parallel results: use the first non-error result
                for result in par_results:
                    if isinstance(result, PipelineEvent):
                        event = result
                        break

            self.timings[stage_name] = (time.monotonic() - t0) * 1000

            if until and stage_name == until:
                break

        return event

    @staticmethod
    async def _run_chain(event: PipelineEvent,
                         entries: list[_PluginEntry]) -> PipelineEvent:
        """Build and execute a middleware chain from the given plugin entries."""
        if not entries:
            return event

        # Build chain from right to left
        async def _noop(ev: PipelineEvent) -> PipelineEvent:
            return ev

        async def _wrap(plugin: BasePlugin, next_fn: NextFunc) -> NextFunc:
            async def _inner(ev: PipelineEvent) -> PipelineEvent:
                if _takes_next(plugin):
                    return await plugin.process(ev, next_fn)
                else:
                    # Simple plugin: run it, then call next(even if not used)
                    ev = await plugin.process(ev)
                    return await next_fn(ev)
            return _inner

        # Build chain: innermost plugin calls _noop, outermost is first
        chain = _noop
        for entry in reversed(entries):
            chain = await _wrap(entry.plugin, chain)

        return await chain(event)


def _takes_next(plugin: BasePlugin) -> bool:
    """Check if plugin.process accepts a second 'next' argument."""
    import inspect
    try:
        sig = inspect.signature(plugin.process)
        params = list(sig.parameters.keys())
        # 'self' or 'event' — count beyond the first
        return len(params) >= 3  # self, event, next
    except Exception:
        return False
