from pydantic import BaseModel


class SearchResult(BaseModel):
    chunk_id: str
    doc_id: str
    doc_title: str
    content: str
    score: float
    source: str = ""  # "vector" | "keyword"


class Source(BaseModel):
    doc_title: str
    chunk_id: str
    content: str
    score: float


class PipelineEvent(BaseModel):
    # Input
    question: str
    kb_ids: list[str]
    session_id: str | None = None

    # Multi-turn conversation history (OpenAI-format messages from previous turns)
    history: list[dict] = []

    # QueryUnderstand
    intent: str = "kb_search"  # greeting | kb_search | general
    rewritten_queries: list[str] = []
    keywords: list[str] = []

    # Search
    search_results: list[SearchResult] = []

    # Rerank
    reranked_results: list[SearchResult] = []

    # ContextBuild
    context_text: str = ""
    system_prompt: str = ""

    # ChatComplete
    answer: str = ""
    sources: list[Source] = []
    token_usage: int = 0


# ── Pipeline event constants ──
# Plugins register on these events; Pipeline fires them in order.
# Multiple plugins can subscribe to the same event — they run sequentially
# in registration order within the event, sharing the same PipelineEvent.
class EventNames:
    QUERY_UNDERSTAND = "query_understand"
    SEARCH = "search"
    RERANK = "rerank"
    CONTEXT_BUILD = "context_build"
    CHAT_COMPLETE = "chat_complete"

    # Execution order
    ORDER = [QUERY_UNDERSTAND, SEARCH, RERANK, CONTEXT_BUILD, CHAT_COMPLETE]
