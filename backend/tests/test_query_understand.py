import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.pipeline.events import PipelineEvent
from backend.pipeline.plugins.query_understand import QueryUnderstandPlugin


@pytest.mark.asyncio
async def test_extract_keywords_and_rewrite():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock()
    # First call: keywords extraction
    mock_client.chat.completions.create.side_effect = [
        MagicMock(choices=[MagicMock(message=MagicMock(content="auth, JWT, expiration"))]),
        MagicMock(choices=[MagicMock(message=MagicMock(content='["JWT token expiration", "authentication token lifetime", "auth expiry time"]'))]),
    ]

    plugin = QueryUnderstandPlugin(client=mock_client, keywords_prompt="Extract keywords:\n{{query}}", rewrite_prompt="Rewrite:\n{{query}}")
    event = PipelineEvent(question="What is the JWT expiration time?", kb_ids=["kb-1"])
    result = await plugin.process(event)

    assert len(result.keywords) > 0
    assert len(result.rewritten_queries) > 0
    # Original question should be included
    assert event.question in result.rewritten_queries


@pytest.mark.asyncio
async def test_noop_when_empty_question():
    plugin = QueryUnderstandPlugin(client=None, keywords_prompt="", rewrite_prompt="")
    event = PipelineEvent(question="", kb_ids=["kb-1"])
    result = await plugin.process(event)
    assert result.rewritten_queries == [""]
    assert result.keywords == []


@pytest.mark.asyncio
async def test_rewrite_on_failure():
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API error"))

    plugin = QueryUnderstandPlugin(client=mock_client, keywords_prompt="kw", rewrite_prompt="rw")
    event = PipelineEvent(question="test", kb_ids=["kb-1"])
    # Fallback: on failure, keywords extracted via regex, rewrite = original question
    result = await plugin.process(event)
    assert result.rewritten_queries == ["test"]
    assert result.keywords == ["test"]
