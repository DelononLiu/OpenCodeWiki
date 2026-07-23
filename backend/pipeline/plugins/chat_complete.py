import json
from openai import AsyncOpenAI
from backend.pipeline.events import PipelineEvent, Source
from backend.pipeline.pipeline import BasePlugin


class ChatCompletePlugin(BasePlugin):
    def __init__(self, client: AsyncOpenAI, model: str, max_tokens: int = 4096, temperature: float = 0.1):
        self.client = client
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        messages = [
            {"role": "system", "content": event.system_prompt},
            *event.history,
            {"role": "user", "content": event.context_text},
        ]

        full_answer = ""
        token_count = 0

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            stream=True,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                full_answer += delta.content
                token_count += 1

        event.answer = full_answer.strip()
        event.token_usage = token_count

        # Extract sources from search results
        results = event.reranked_results if event.reranked_results else event.search_results
        event.sources = [
            Source(
                doc_title=r.doc_title,
                chunk_id=r.chunk_id,
                content=r.content[:200],
                score=r.score,
            )
            for r in results[:5]
        ]

        return event

    async def stream(self, event: PipelineEvent):
        """Async generator that yields SSE event strings."""
        messages = [
            {"role": "system", "content": event.system_prompt},
            *event.history,
            {"role": "user", "content": event.context_text},
        ]

        event_id = 0
        full_answer = ""

        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=self.max_tokens,
                temperature=self.temperature,
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    full_answer += delta.content
                    event_id += 1
                    event_text = json.dumps({"text": delta.content, "event_id": event_id})
                    yield f"event: token\ndata: {event_text}\n\n"

            # Yield sources
            results = event.reranked_results if event.reranked_results else event.search_results
            sources_data = [
                {"doc_title": r.doc_title, "chunk_id": r.chunk_id, "content": r.content[:200], "score": r.score}
                for r in results[:5]
            ]
            yield f"event: sources\ndata: {json.dumps(sources_data)}\n\n"

            # Done
            event.answer = full_answer.strip()
            event.sources = [
                Source(doc_title=s["doc_title"], chunk_id=s["chunk_id"], content=s["content"], score=s["score"])
                for s in sources_data
            ]
            done_data = json.dumps({"session_id": event.session_id or "", "tokens": event_id})
            yield f"event: done\ndata: {done_data}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
