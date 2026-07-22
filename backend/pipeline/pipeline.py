from abc import ABC, abstractmethod
from backend.pipeline.events import PipelineEvent


class BasePlugin(ABC):
    @abstractmethod
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        ...


class Pipeline:
    def __init__(self):
        self.plugins: list[BasePlugin] = []

    def register(self, plugin: BasePlugin) -> None:
        self.plugins.append(plugin)

    async def run(self, event: PipelineEvent) -> PipelineEvent:
        for plugin in self.plugins:
            event = await plugin.process(event)
        return event
