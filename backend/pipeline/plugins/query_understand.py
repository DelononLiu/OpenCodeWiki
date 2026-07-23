import json
from openai import AsyncOpenAI
from backend.pipeline.events import PipelineEvent
from backend.pipeline.pipeline import BasePlugin


class QueryUnderstandPlugin(BasePlugin):
    def __init__(self, client: AsyncOpenAI, model: str = "", keywords_prompt: str = "", rewrite_prompt: str = ""):
        self.client = client
        self.model = model
        self.keywords_prompt = keywords_prompt
        self.rewrite_prompt = rewrite_prompt

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        # Step 1: Extract keywords (with fallback)
        try:
            event.keywords = await self._extract_keywords(event.question)
        except Exception:
            event.keywords = []
        if not event.keywords:
            # Fallback: extract words from raw question (supports Chinese)
            import re
            words = re.findall(r'[a-zA-Z0-9一-鿿]+', event.question)
            event.keywords = list(set(words))[:10]

        # Step 2: Rewrite query + classify intent (with fallback)
        try:
            queries, intent = await self._rewrite(event.question)
            event.rewritten_queries = queries
            event.intent = intent
        except Exception:
            event.rewritten_queries = [event.question]
            event.intent = "kb_search"

        # Always include original question as a search query
        if event.question not in event.rewritten_queries:
            event.rewritten_queries.insert(0, event.question)

        return event

    async def _extract_keywords(self, question: str) -> list[str]:
        if not question.strip():
            return []

        prompt = self.keywords_prompt.replace("{{query}}", question).replace("{{language}}", "Chinese")
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=100,
        )
        text = response.choices[0].message.content.strip()
        keywords = [kw.strip() for kw in text.split(",") if kw.strip()]
        return keywords[:10]

    async def _rewrite(self, question: str) -> tuple[list[str], str]:
        """Returns (queries, intent). Intent defaults to 'kb_search'."""
        if not question.strip():
            return [question], "kb_search"

        prompt = self.rewrite_prompt.replace("{{query}}", question)
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=200,
        )
        text = response.choices[0].message.content.strip()

        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data.get("queries", [question])[:3], data.get("intent", "kb_search")
            if isinstance(data, list):
                return data[:3], "kb_search"  # old format fallback
        except json.JSONDecodeError:
            pass

        return [question], "kb_search"
