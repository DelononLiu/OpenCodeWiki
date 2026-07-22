import os
import re
from dataclasses import dataclass, field
import yaml


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8765


@dataclass
class LLMConfig:
    provider: str = "openai"
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    max_tokens: int = 4096
    temperature: float = 0.1


@dataclass
class EmbeddingConfig:
    provider: str = "openai"
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model: str = "text-embedding-3-small"
    dimensions: int = 1536


@dataclass
class DatabaseConfig:
    path: str = "~/.opencodewiki"


@dataclass
class KnowledgeConfig:
    chunk_size: int = 512
    chunk_overlap: int = 50
    max_file_size_mb: int = 20


@dataclass
class RetrievalConfig:
    vector_top_k: int = 20
    keyword_top_k: int = 10
    rerank_top_k: int = 5
    rrf_k: int = 60


@dataclass
class PromptsConfig:
    dir: str = "./backend/prompts"


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    knowledge: KnowledgeConfig = field(default_factory=KnowledgeConfig)
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    prompts: PromptsConfig = field(default_factory=PromptsConfig)


def _resolve_env(value: str) -> str:
    """Resolve ${ENV_VAR} references in a string value."""
    if isinstance(value, str):
        pattern = re.compile(r'\$\{(\w+)\}')
        matches = pattern.findall(value)
        for var in matches:
            env_val = os.environ.get(var, "")
            value = value.replace(f"${{{var}}}", env_val)
    return value


def load_config(path: str | None = None) -> Config:
    cfg = Config()
    if path is None:
        path = os.path.expanduser("~/.opencodewiki/config.yaml")

    if os.path.exists(path):
        with open(path) as f:
            raw = yaml.safe_load(f) or {}

        if "server" in raw:
            cfg.server = ServerConfig(**{
                k: v for k, v in raw["server"].items()
                if k in ServerConfig.__dataclass_fields__
            })
        if "llm" in raw:
            data = {k: _resolve_env(v) for k, v in raw["llm"].items()}
            cfg.llm = LLMConfig(**{
                k: v for k, v in data.items()
                if k in LLMConfig.__dataclass_fields__
            })
        if "embedding" in raw:
            data = {k: _resolve_env(v) for k, v in raw["embedding"].items()}
            cfg.embedding = EmbeddingConfig(**{
                k: v for k, v in data.items()
                if k in EmbeddingConfig.__dataclass_fields__
            })
        if "database" in raw:
            cfg.database = DatabaseConfig(**{
                k: v for k, v in raw["database"].items()
                if k in DatabaseConfig.__dataclass_fields__
            })
        if "knowledge" in raw:
            cfg.knowledge = KnowledgeConfig(**{
                k: v for k, v in raw["knowledge"].items()
                if k in KnowledgeConfig.__dataclass_fields__
            })
        if "retrieval" in raw:
            cfg.retrieval = RetrievalConfig(**{
                k: v for k, v in raw["retrieval"].items()
                if k in RetrievalConfig.__dataclass_fields__
            })
        if "prompts" in raw:
            cfg.prompts = PromptsConfig(**{
                k: v for k, v in raw["prompts"].items()
                if k in PromptsConfig.__dataclass_fields__
            })

    # Environment overrides take precedence over YAML
    if os.environ.get("LLM_API_KEY"):
        cfg.llm.api_key = os.environ["LLM_API_KEY"]
    if os.environ.get("EMBEDDING_API_KEY"):
        cfg.embedding.api_key = os.environ["EMBEDDING_API_KEY"]

    return cfg
