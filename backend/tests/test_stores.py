import os
import tempfile
import uuid
from backend.database import init_databases, get_knora_db
from backend.config import Config
from backend.stores.kb import create_kb, list_kbs, get_kb, delete_kb
from backend.stores.doc import create_document, get_document, list_documents, delete_document, create_chunk, delete_chunks_by_doc, get_chunks_by_doc
from backend.stores.session import create_session, get_session, list_sessions, delete_session, create_message, get_messages


def setup_module():
    db_path = tempfile.mkdtemp()
    cfg = Config()
    cfg.database.path = db_path
    init_databases(cfg)

def test_create_and_list_kb():
    kb = create_kb("Test KB", "A test knowledge base")
    assert kb["name"] == "Test KB"
    assert kb["id"]
    kbs = list_kbs()
    assert len(kbs) == 1
    assert kbs[0]["name"] == "Test KB"

def test_get_and_delete_kb():
    kb = create_kb("To Delete", "")
    assert get_kb(kb["id"]) is not None
    delete_kb(kb["id"])
    assert get_kb(kb["id"]) is None

def test_create_and_list_documents():
    kb = create_kb("Doc KB", "")
    doc = create_document(kb["id"], "readme.md", "/tmp/readme.md", "abc123", "md")
    assert doc["status"] == "processing"
    docs = list_documents(kb["id"])
    assert len(docs) == 1
    assert docs[0]["title"] == "readme.md"

def test_chunks_crud():
    kb = create_kb("Chunk KB", "")
    doc = create_document(kb["id"], "doc.md", "/tmp/doc.md", "def456", "md")
    c1 = create_chunk(doc["id"], kb["id"], "chunk content 1", 0, '{"heading":"Intro"}')
    c2 = create_chunk(doc["id"], kb["id"], "chunk content 2", 1, '{}')
    chunks = get_chunks_by_doc(doc["id"])
    assert len(chunks) == 2
    delete_chunks_by_doc(doc["id"])
    assert len(get_chunks_by_doc(doc["id"])) == 0

def test_session_and_messages():
    kb = create_kb("Session KB", "")
    ses = create_session(kb["id"], "Test Session")
    assert ses["kb_id"] == kb["id"]
    msg = create_message(ses["id"], "user", "hello", "[]", 0)
    assert msg["role"] == "user"
    msgs = get_messages(ses["id"])
    assert len(msgs) == 1

def test_session_owner_scoping():
    ses1 = create_session("kb1", "s1", owner_id="usr-a")
    ses2 = create_session("kb1", "s2", owner_id="usr-b")
    legacy = create_session("kb1", "legacy")
    ids_a = {s["id"] for s in list_sessions(None, owner_id="usr-a")}
    assert ses1["id"] in ids_a and ses2["id"] not in ids_a and legacy["id"] in ids_a
