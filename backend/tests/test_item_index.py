import asyncio
import tempfile
from backend.database import init_databases, get_vectors_db, get_knora_db
from backend.config import Config
from backend.stores.users import create_user
from backend.stores.items import create_item, approve_item, submit_item
from backend.knowledge.vector_store import (
    search_item_vector, search_item_keyword, delete_item_vectors, insert_item_vectors,
)


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def _embed_stub(texts):
    """2048 维确定性向量（内容相关）。"""
    import hashlib
    vecs = []
    for t in texts:
        h = hashlib.sha256(t.encode()).digest()
        vec = [((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)]
        vecs.append(vec)
    return vecs

def _index_team_item(title, content):
    owner = create_user("alice", "pw")["id"]
    item = create_item(owner, title, content, scope="team")  # team → published
    vecs = _embed_stub([content])
    insert_item_vectors([{"item_id": item["id"], "vector": vecs[0],
                          "text": f"{title}\n{content}", "keywords": title}])
    return item

def test_insert_and_vector_search():
    item = _index_team_item("Kubernetes 部署", "集群部署需要配置 kubeconfig 和网络插件")
    vecs = _embed_stub(["部署集群配置 kubeconfig"])
    results = search_item_vector(vecs[0], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)
    assert results[0]["doc_id"] == item["id"]

def test_keyword_search_items():
    item = _index_team_item("React 并发", "React 18 引入并发特性")
    results = search_item_keyword(["并发"], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)

def test_personal_items_excluded():
    owner = create_user("bob", "pw")["id"]
    priv = create_item(owner, "私有笔记", "不可检索的私人内容")
    vecs = _embed_stub(["私人内容"])
    insert_item_vectors([{"item_id": priv["id"], "vector": vecs[0],
                          "text": "私有笔记 不可检索的私人内容", "keywords": "私有"}])
    results = search_item_keyword(["私人"], top_k=5)
    assert all(r["chunk_id"] != priv["id"] for r in results)

def test_delete_item_vectors():
    item = _index_team_item("临时卡", "临时内容")
    delete_item_vectors(item["id"])
    results = search_item_keyword(["临时"], top_k=5)
    assert all(r["chunk_id"] != item["id"] for r in results)

def test_index_item_end_to_end():
    import hashlib
    class StubEmbedder:
        async def embed(self, texts):
            vecs = []
            for t in texts:
                h = hashlib.sha256(t.encode()).digest()
                vecs.append([((h[i % 32] + i) % 256) / 128.0 - 1.0 for i in range(2048)])
            return vecs

    from backend.knowledge.item_index import index_item, delete_item_index
    owner = create_user("carol", "pw")["id"]
    item = create_item(owner, "端到端", "这是一段用于端到端索引测试的内容", scope="team")
    asyncio.run(index_item(item, StubEmbedder()))
    results = search_item_keyword(["端到端"], top_k=5)
    assert any(r["chunk_id"] == item["id"] for r in results)
    delete_item_index(item["id"])
    results = search_item_keyword(["端到端"], top_k=5)
    assert all(r["chunk_id"] != item["id"] for r in results)
