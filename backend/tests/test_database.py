import os
import tempfile
from backend.database import init_databases, get_knora_db, get_vectors_db


def test_init_databases_creates_tables():
    db_path = tempfile.mkdtemp()
    os.environ['KNORA_DB_PATH'] = db_path
    from backend.config import Config
    cfg = Config()
    cfg.database.path = db_path

    init_databases(cfg)

    knora = get_knora_db()
    tables = knora.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t[0] for t in tables]
    assert "knowledge_bases" in table_names
    assert "documents" in table_names
    assert "chunks" in table_names
    assert "sessions" in table_names
    assert "messages" in table_names

    vectors = get_vectors_db()
    vec_tables = vectors.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    vec_table_names = [t[0] for t in vec_tables]
    assert "vector_chunks" in vec_table_names
    assert "chunk_fts" in vec_table_names

    knora.close()
    vectors.close()
    import shutil
    shutil.rmtree(db_path)
