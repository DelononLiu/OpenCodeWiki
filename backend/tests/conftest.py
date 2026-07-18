"""
conftest.py — 全局 pytest fixture。

提供：
- 内存 SQLite 数据库 fixture（qa_db / knowledge_db）
- 存储层 mock fixture（将所有 store 操作重定向到内存 DB）
- FastAPI TestClient fixture
- Mock LLM fixture（用于 agent 测试）
"""

import sqlite3
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── 内存数据库 fixture ─────────────────────────────────────────


@pytest.fixture
def qa_db():
    """创建独立内存 SQLite，包含 qa.db 完整 schema"""
    from database import _init_qa_db

    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    _init_qa_db(db)
    yield db
    db.close()


@pytest.fixture
def knowledge_db():
    """创建独立内存 SQLite，包含 knowledge.db 完整 schema"""
    from database import _init_knowledge_db

    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    _init_knowledge_db(db)
    yield db
    db.close()


# ── 存储层 mock ────────────────────────────────────────────────


@pytest.fixture
def patch_stores(qa_db, knowledge_db):
    """Mock 所有 store 层的 get_db 调用，重定向到内存 SQLite"""
    with patch("stores.qa.get_qa_db", return_value=qa_db):
        with patch("stores.topics.get_knowledge_db", return_value=knowledge_db):
            yield


@pytest.fixture
def patch_main_stores(qa_db, knowledge_db):
    """Mock main.py 内部 store 调用（路由直接导入的函数内部使用 get_db）"""
    with patch("stores.qa.get_qa_db", return_value=qa_db):
        with patch("stores.topics.get_knowledge_db", return_value=knowledge_db):
            yield


# ── HTTP 客户端 fixture ─────────────────────────────────────────


@pytest.fixture
def client(patch_main_stores):
    """返回 FastAPI TestClient，所有 store 已 mock 为内存数据库"""
    from main import app

    with TestClient(app) as c:
        yield c


# ── Mock LLM fixture ───────────────────────────────────────────


@pytest.fixture
def mock_llm():
    """返回一个预设响应的 mock LLM，用于 agent 测试"""
    llm = MagicMock()
    llm.invoke.return_value.content = "general"
    llm.ainvoke.return_value = MagicMock()
    llm.ainvoke.return_value.content = "general"
    return llm
