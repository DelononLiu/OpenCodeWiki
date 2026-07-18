"""
配置读取：从 ~/.opencodewiki/config.json 读取 LLM/API 配置。
与 TS 侧 resolveLLMConfig() 读同一个文件。
"""

import json
import os
from pathlib import Path
from typing import Optional

CONFIG_PATH = Path.home() / ".opencodewiki" / "config.json"


def load_config() -> dict:
    """加载 ~/.opencodewiki/config.json，不存在则返回空 dict"""
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def get_llm_config() -> dict:
    """
    获取 LLM 配置，优先级：环境变量 > config.json。
    返回格式：{ apiKey, baseUrl, model, provider }
    """
    cfg = load_config()

    api_key = (
        os.environ.get("OPENAI_API_KEY")
        or os.environ.get("LLM_API_KEY")
        or cfg.get("apiKey", "")
    )
    base_url = (
        os.environ.get("LLM_BASE_URL")
        or cfg.get("baseUrl", "https://api.openai.com/v1")
    )
    model = (
        os.environ.get("LLM_MODEL")
        or cfg.get("model", "gpt-4o-mini")
    )
    provider = cfg.get("provider", "openai")

    return {
        "apiKey": api_key,
        "baseUrl": base_url.rstrip("/"),
        "model": model,
        "provider": provider,
    }


def get_codegraph_bridge_url() -> str:
    """获取 TS codegraph-bridge 的基地址（含 BASE_PATH）"""
    base = os.environ.get("CODEGRAPH_BRIDGE_URL", "http://localhost:4747")
    cfg = load_config()
    base_path = cfg.get("basePath", "") or ""
    if base_path and not base.endswith(base_path):
        base = base.rstrip("/") + "/" + base_path.lstrip("/")
    return base


def is_agent_enabled() -> bool:
    """是否启用 Python LangGraph Agent"""
    return os.environ.get("OPENCODEWIKI_AGENT_ENABLE", "").lower() in ("true", "1", "yes")
