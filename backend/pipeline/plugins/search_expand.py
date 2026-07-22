"""
ExpandContextPlugin — adds neighboring chunks to search results.

Subscribes to SEARCH event. After SearchPlugin has filled search_results,
this plugin walks chunk_index to pull in previous/next chunks for context,
mirroring WeKnora's expandShortContextWithNeighbors strategy.

Register it AFTER SearchPlugin on the same SEARCH event:
    pipeline.on(EventNames.SEARCH, SearchPlugin(...))
    pipeline.on(EventNames.SEARCH, ExpandContextPlugin(...))
"""

from backend.pipeline.events import PipelineEvent, SearchResult, EventNames
from backend.pipeline.pipeline import BasePlugin
from backend.stores.doc import get_chunks_by_doc


class ExpandContextPlugin(BasePlugin):
    """Expands top results by pulling in neighboring chunks (prev/next chunk_index)."""

    def __init__(self, expand_count: int = 1, expand_top_k: int = 3):
        self.expand_count = expand_count  # neighbors per side
        self.expand_top_k = expand_top_k   # expand only top N results

    def events(self) -> list[str]:
        return [EventNames.SEARCH]

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        if not event.search_results:
            return event

        expanded_ids: set[str] = {r.chunk_id for r in event.search_results}
        new_results: list[SearchResult] = []

        # Walk doc chunks to find neighbors
        doc_chunks: dict[str, list[dict]] = {}

        for sr in event.search_results[:self.expand_top_k]:
            # Fetch all chunks for this document once
            if sr.doc_id not in doc_chunks:
                doc_chunks[sr.doc_id] = get_chunks_by_doc(sr.doc_id)

            chunks = doc_chunks[sr.doc_id]
            # Find current chunk's index
            cur_idx = None
            for i, ch in enumerate(chunks):
                if ch["id"] == sr.chunk_id:
                    cur_idx = i
                    break

            if cur_idx is None:
                continue

            # Pull in neighbors
            start = max(0, cur_idx - self.expand_count)
            end = min(len(chunks), cur_idx + self.expand_count + 1)
            for i in range(start, end):
                ch = chunks[i]
                if ch["id"] not in expanded_ids:
                    expanded_ids.add(ch["id"])
                    new_results.append(SearchResult(
                        chunk_id=ch["id"],
                        doc_id=sr.doc_id,
                        doc_title=sr.doc_title,
                        content=ch.get("content", ""),
                        score=sr.score * 0.9,  # slightly lower than the matched result
                        source="expand",
                    ))

        # Append expanded results after original results
        event.search_results.extend(new_results)
        return event
