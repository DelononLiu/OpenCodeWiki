from backend.database import get_knora_db, get_vectors_db


def test_init_databases_creates_tables():
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


def test_new_tables_exist():
    from backend.database import get_knora_db
    db = get_knora_db()
    for table in ("users", "knowledge_items", "item_links", "review_tasks", "item_derivations", "wiki_nodes"):
        row = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        assert row is not None, f"table {table} missing"

def test_sessions_have_owner_column():
    from backend.database import get_knora_db
    db = get_knora_db()
    cols = [r[1] for r in db.execute("PRAGMA table_info(sessions)").fetchall()]
    assert "owner_id" in cols

def test_knowledge_items_check_constraints():
    from backend.database import get_knora_db
    db = get_knora_db()
    db.execute(
        "INSERT INTO users (id, username, password_hash, role) VALUES ('usr-t1', 't1', 'h', 'user')"
    )
    db.commit()
    try:
        db.execute(
            "INSERT INTO knowledge_items (id, title, content_md, form, scope, status, owner_id) "
            "VALUES ('it-t1', 'x', 'y', 'bad-form', 'personal', 'draft', 'usr-t1')"
        )
        db.commit()
        assert False, "bad form should violate CHECK"
    except Exception:
        pass
