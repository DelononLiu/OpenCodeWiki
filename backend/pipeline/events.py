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

    # QueryUnderstand
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
