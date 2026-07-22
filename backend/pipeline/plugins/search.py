import asyncio
from backend.pipeline.events import PipelineEvent, SearchResult
from backend.pipeline.pipeline import BasePlugin
from backend.knowledge.embedder import Embedder
from backend.knowledge.vector_store import search_vector, search_keyword


class SearchPlugin(BasePlugin):
    def __init__(self, embedder: Embedder, top_k: int = 20, keyword_top_k: int = 10, rrf_k: int = 60):
        self.embedder = embedder
        self.top_k = top_k
        self.keyword_top_k = keyword_top_k
        self.rrf_k = rrf_k

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        kb_id = event.kb_ids[0]

        # Run vector and keyword search in parallel
        vector_results, keyword_results = await asyncio.gather(
            self._vector_search(event, kb_id),
            self._keyword_search(event, kb_id),
        )

        # RRF merge
        event.search_results = self._rrf_merge(vector_results, keyword_results)
        return event

    async def _vector_search(self, event: PipelineEvent, kb_id: str) -> list[dict]:
        all_results = []
        seen = set()
        for query in event.rewritten_queries[:3]:
            vec = await self.embedder.embed_single(query)
            results = search_vector(vec, kb_id, self.top_k)
            for r in results:
                if r["chunk_id"] not in seen:
                    seen.add(r["chunk_id"])
                    all_results.append(r)
        return all_results

    async def _keyword_search(self, event: PipelineEvent, kb_id: str) -> list[dict]:
        if not event.keywords:
            return []
        return search_keyword(event.keywords, kb_id, self.keyword_top_k)

    def _rrf_merge(self, vector_results: list[dict], keyword_results: list[dict]) -> list[SearchResult]:
        scores: dict[str, float] = {}
        docs: dict[str, dict] = {}

        for rank, r in enumerate(vector_results):
            cid = r["chunk_id"]
            scores[cid] = scores.get(cid, 0) + 1.0 / (self.rrf_k + rank + 1)
            docs[cid] = r

        for rank, r in enumerate(keyword_results):
            cid = r["chunk_id"]
            scores[cid] = scores.get(cid, 0) + 1.0 / (self.rrf_k + rank + 1)
            docs[cid] = r

        sorted_items = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [
            SearchResult(
                chunk_id=cid,
                doc_id=docs[cid].get("doc_id", ""),
                doc_title=docs[cid].get("title", ""),
                content=docs[cid].get("content", ""),
                score=score,
                source=docs[cid].get("source", "merged"),
            )
            for cid, score in sorted_items[:self.top_k]
        ]
