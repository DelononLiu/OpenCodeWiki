import pytest
from backend.pipeline.events import SearchResult, Source, PipelineEvent
from backend.pipeline.pipeline import BasePlugin, Pipeline, PipelinePlan
from backend.pipeline.events import EventNames

class EchoPlugin(BasePlugin):
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        event.answer = event.question
        return event

    def events(self) -> list[str]:
        return [EventNames.QUERY_UNDERSTAND]

class AppendPlugin(BasePlugin):
    async def process(self, event: PipelineEvent) -> PipelineEvent:
        event.keywords.append("test-keyword")
        return event

    def events(self) -> list[str]:
        return [EventNames.QUERY_UNDERSTAND]

@pytest.mark.asyncio
async def test_pipeline_executes_in_order():
    plan = PipelinePlan().add(EventNames.QUERY_UNDERSTAND)
    pipeline = Pipeline(plan=plan)
    pipeline.on(EventNames.QUERY_UNDERSTAND, AppendPlugin())
    pipeline.on(EventNames.QUERY_UNDERSTAND, EchoPlugin())
    event = PipelineEvent(question="hello", kb_ids=["kb-1"])
    result = await pipeline.run(event)
    assert result.keywords == ["test-keyword"]
    assert result.answer == "hello"

def test_search_result_model():
    sr = SearchResult(chunk_id="chk-1", doc_id="doc-1", doc_title="readme.md", content="hello world", score=0.95, source="vector")
    assert sr.chunk_id == "chk-1"
    assert sr.source == "vector"

def test_pipeline_event_defaults():
    event = PipelineEvent(question="test", kb_ids=["kb-1"])
    assert event.rewritten_queries == []
    assert event.search_results == []
    assert event.reranked_results == []
