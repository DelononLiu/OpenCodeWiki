import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.pipeline.events import PipelineEvent, SearchResult
from backend.pipeline.plugins.search import SearchPlugin
from backend.pipeline.plugins.rerank import RerankPlugin
from backend.pipeline.plugins.context_build import ContextBuildPlugin

@pytest.mark.asyncio
async def test_search_plugin_calls_vector_and_keyword():
    mock_embedder = MagicMock()
    mock_embedder.embed_single = AsyncMock(return_value=[0.1, 0.2, 0.3])

    with patch('backend.pipeline.plugins.search.search_vector') as mock_vec:
        mock_vec.return_value = [
            {"chunk_id": "c1", "content": "JWT auth docs", "doc_id": "d1", "score": 0.9, "source": "vector"},
        ]
        with patch('backend.pipeline.plugins.search.search_keyword') as mock_kw:
            mock_kw.return_value = [
                {"chunk_id": "c2", "content": "token config", "doc_id": "d2", "score": 2.5, "source": "keyword"},
            ]
            plugin = SearchPlugin(embedder=mock_embedder, top_k=20, keyword_top_k=10, rrf_k=60)
            event = PipelineEvent(
                question="JWT auth",
                kb_ids=["kb-1"],
                rewritten_queries=["JWT authentication", "token authentication"],
                keywords=["JWT", "auth"]
            )
            result = await plugin.process(event)
            assert len(result.search_results) > 0

@pytest.mark.asyncio
async def test_rerank_plugin_skips_when_unconfigured():
    plugin = RerankPlugin(client=None)
    sr = SearchResult(chunk_id="c1", doc_id="d1", doc_title="doc.md", content="test", score=0.9, source="vector")
    event = PipelineEvent(question="test", kb_ids=["kb-1"], search_results=[sr])
    result = await plugin.process(event)
    # Should pass through: reranked = top_k from search_results
    assert result.reranked_results == result.search_results[:5]

@pytest.mark.asyncio
async def test_context_build_plugin():
    system_template = "You are helpful.\n\n{{contexts}}"
    context_template = "### References:\n{{contexts}}\n\n### Question:\n{{query}}"

    plugin = ContextBuildPlugin(system_prompt_template=system_template, context_template=context_template)
    sr = SearchResult(chunk_id="c1", doc_id="d1", doc_title="doc.md", content="Important content here.", score=0.9, source="vector")
    event = PipelineEvent(question="test question", kb_ids=["kb-1"], search_results=[sr])

    result = await plugin.process(event)
    assert "Important content" in result.context_text
    assert "You are helpful" in result.system_prompt
    assert "test question" in result.context_text

@pytest.mark.asyncio
async def test_search_plugin_includes_team_items():
    import asyncio
    from backend.stores.users import create_user
    from backend.stores.items import create_item
    from backend.knowledge.vector_store import insert_item_vectors

    owner = create_user("searcher", "pw")["id"]
    item = create_item(owner, "团队检索卡", "这个卡片讲的是异步任务队列的实现", scope="team")
    # 伪造固定向量
    import hashlib
    h = hashlib.sha256("异步任务队列".encode()).digest()
    vec = [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]
    insert_item_vectors([{"item_id": item["id"], "vector": vec,
                          "text": "团队检索卡 这个卡片讲的是异步任务队列的实现",
                          "keywords": "异步"}])

    class StubEmbedder:
        async def embed_single(self, text):
            h = hashlib.sha256(text.encode()).digest()
            return [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]

    plugin = SearchPlugin(embedder=StubEmbedder(), top_k=10, keyword_top_k=5, rrf_k=60)
    event = PipelineEvent(question="异步任务队列怎么做？", kb_ids=["kb-x"], intent="kb_search",
                          rewritten_queries=["异步任务队列"], keywords=["异步"])
    event = await plugin.process(event)
    assert any(r.chunk_id == item["id"] for r in event.search_results)
