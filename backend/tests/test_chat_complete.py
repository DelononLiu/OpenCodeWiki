import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.pipeline.events import PipelineEvent, SearchResult
from backend.pipeline.plugins.chat_complete import ChatCompletePlugin

@pytest.mark.asyncio
async def test_chat_complete_streams_tokens():
    mock_client = MagicMock()
    # Mock streaming response
    async def mock_stream():
        yield MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello"))])
        yield MagicMock(choices=[MagicMock(delta=MagicMock(content=" world"))])
        yield MagicMock(choices=[MagicMock(delta=MagicMock(content=""), finish_reason="stop")])

    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())

    plugin = ChatCompletePlugin(client=mock_client, model="gpt-4o-mini", max_tokens=4096, temperature=0.1)
    sr = SearchResult(chunk_id="c1", doc_id="d1", doc_title="doc.md", content="ref content", score=0.9, source="vector")
    event = PipelineEvent(
        question="test", kb_ids=["kb-1"],
        context_text="Context: ref content\n\nQuestion: test",
        system_prompt="You are helpful assistant.",
        search_results=[sr]
    )

    result = await plugin.process(event)
    assert "Hello world" in result.answer
    assert result.token_usage > 0
    assert len(result.sources) > 0

@pytest.mark.asyncio
async def test_chat_complete_sources_extracted():
    mock_client = MagicMock()

    async def mock_stream():
        yield MagicMock(choices=[MagicMock(delta=MagicMock(content="answer"), finish_reason="stop")])

    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())

    plugin = ChatCompletePlugin(client=mock_client, model="test", max_tokens=100, temperature=0)
    sr1 = SearchResult(chunk_id="c1", doc_id="d1", doc_title="auth.py", content="JWT config", score=0.9, source="vector")
    sr2 = SearchResult(chunk_id="c2", doc_id="d2", doc_title="config.yaml", content="expiry: 24h", score=0.8, source="keyword")
    event = PipelineEvent(
        question="test", kb_ids=["kb-1"],
        context_text="ctx", system_prompt="sys",
        search_results=[sr1, sr2]
    )

    result = await plugin.process(event)
    assert len(result.sources) == 2
    assert result.sources[0].doc_title in ("auth.py", "config.yaml")
