import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.knowledge.embedder import Embedder


@pytest.mark.asyncio
async def test_embed_batch():
    mock_client = MagicMock()
    mock_client.embeddings.create = AsyncMock(return_value=MagicMock(
        data=[
            MagicMock(embedding=[0.1, 0.2, 0.3]),
            MagicMock(embedding=[0.4, 0.5, 0.6]),
        ]
    ))
    embedder = Embedder(client=mock_client, model="test-model", dimensions=3)
    vectors = await embedder.embed(["text one", "text two"])
    assert len(vectors) == 2
    assert vectors[0] == [0.1, 0.2, 0.3]
    assert vectors[1] == [0.4, 0.5, 0.6]


@pytest.mark.asyncio
async def test_embed_single():
    mock_client = MagicMock()
    mock_client.embeddings.create = AsyncMock(return_value=MagicMock(
        data=[MagicMock(embedding=[0.7, 0.8, 0.9])]
    ))
    embedder = Embedder(client=mock_client, model="test", dimensions=3)
    vec = await embedder.embed_single("hello")
    assert vec == [0.7, 0.8, 0.9]


@pytest.mark.asyncio
async def test_embed_large_batch_splits():
    mock_client = MagicMock()
    call_count = 0
    async def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        texts = kwargs.get("input", args[0] if args else [])
        return MagicMock(data=[MagicMock(embedding=[0.0]) for _ in (texts if isinstance(texts, list) else [texts])])

    mock_client.embeddings.create = AsyncMock(side_effect=side_effect)
    embedder = Embedder(client=mock_client, model="test", dimensions=1, batch_size=2)
    vectors = await embedder.embed(["a", "b", "c", "d", "e"])
    assert len(vectors) == 5
    assert call_count == 3  # 2+2+1
