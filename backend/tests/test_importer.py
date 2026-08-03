import os
import tempfile
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.knowledge.importer import parse_file, import_document
from backend.database import init_databases
from backend.config import Config
from backend.stores.kb import create_kb
from backend.stores.doc import create_document, get_document


def setup_module():
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    init_databases(cfg)

def test_parse_markdown():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write("# Hello\n\nThis is a test markdown file.")
        path = f.name
    text = parse_file(path, "md")
    assert "Hello" in text
    assert "test markdown" in text
    os.unlink(path)

def test_parse_text():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write("Plain text content here.")
        path = f.name
    text = parse_file(path, "txt")
    assert "Plain text" in text
    os.unlink(path)

@pytest.mark.asyncio
async def test_import_document_flow():
    kb = create_kb("Import KB", "")
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write("# Doc\n\nContent for testing import.")
        path = f.name

    doc = create_document(kb["id"], "test.md", path, "hash123", "md")

    # Vector dimension must match the configured embedding dimension (the
    # vector_chunks table is created with this many dims by init_databases).
    dim = Config().embedding.dimensions

    # Mock embedder and run import
    mock_embedder = MagicMock()
    mock_embedder.embed = AsyncMock(return_value=[[0.0] * dim])
    mock_embedder.embed_single = AsyncMock(return_value=[0.0] * dim)

    with patch('backend.knowledge.importer.Embedder', return_value=mock_embedder):
        # We need a small chunk_size so the test creates multiple chunks
        cfg = Config()
        cfg.database.path = tempfile.mkdtemp()
        cfg.knowledge.chunk_size = 100
        cfg.embedding.dimensions = dim
        cfg.embedding.api_key = "test-key"
        init_databases(cfg)

        # re-create doc in the correct db
        from backend.stores.doc import create_document as cd
        kb2 = create_kb("Import KB2", "")
        doc2 = cd(kb2["id"], "test.md", path, "hash456", "md")

        await import_document(doc2["id"], path, kb2["id"], cfg)

        result = get_document(doc2["id"])
        assert result["status"] == "completed"

    os.unlink(path)
