import os
import pytest
import tempfile
import yaml
from backend.config import Config, load_config

DEFAULT_YAML = """
server:
  host: "0.0.0.0"
  port: 8765
llm:
  provider: "openai"
  api_key: "test-key"
  base_url: "https://api.openai.com/v1"
  model: "gpt-4o-mini"
  max_tokens: 4096
  temperature: 0.1
embedding:
  provider: "openai"
  api_key: "emb-key"
  base_url: "https://api.openai.com/v1"
  model: "text-embedding-3-small"
  dimensions: 1536
database:
  path: "./data"
knowledge:
  chunk_size: 512
  chunk_overlap: 50
  max_file_size_mb: 20
retrieval:
  vector_top_k: 20
  keyword_top_k: 10
  rerank_top_k: 5
  rrf_k: 60
prompts:
  dir: "./backend/prompts"
"""

def test_load_config_from_yaml():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        f.write(DEFAULT_YAML)
        path = f.name
    os.environ.pop('LLM_API_KEY', None)
    os.environ.pop('EMBEDDING_API_KEY', None)
    cfg = load_config(path)
    assert cfg.llm.provider == "openai"
    assert cfg.llm.model == "gpt-4o-mini"
    assert cfg.embedding.model == "text-embedding-3-small"
    assert cfg.retrieval.vector_top_k == 20
    assert cfg.knowledge.chunk_size == 512
    os.unlink(path)

def test_env_var_override():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        f.write(DEFAULT_YAML)
        path = f.name
    os.environ['LLM_API_KEY'] = 'env-override-key'
    cfg = load_config(path)
    assert cfg.llm.api_key == 'env-override-key'
    os.unlink(path)
    os.environ.pop('LLM_API_KEY', None)

def test_config_defaults():
    cfg = Config()
    assert cfg.server.port == 8100
    assert cfg.llm.model == "deepseek-v4-flash"
    assert cfg.retrieval.vector_top_k == 20
