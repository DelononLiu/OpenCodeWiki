from backend.pipeline.events import PipelineEvent
from backend.pipeline.pipeline import BasePlugin


class RerankPlugin(BasePlugin):
    def __init__(self, client=None, model: str = "", top_k: int = 5):
        self.client = client
        self.model = model
        self.top_k = top_k

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        if self.client is None:
            # No rerank service configured — just truncate
            event.reranked_results = event.search_results[:self.top_k]
        else:
            # Future: cross-encoder or LLM-based rerank
            event.reranked_results = event.search_results[:self.top_k]
        return event
