"""知识项向量索引：切片 → embedding → 写入 item_vec0/item_fts。"""
from backend.knowledge.chunker import Chunker
from backend.knowledge.vector_store import insert_item_vectors, delete_item_vectors


async def index_item(item: dict, embedder) -> None:
    """对团队已发布的知识项建立向量索引（幂等：先清旧索引）。"""
    delete_item_vectors(item["id"])
    chunks = Chunker(chunk_size=256, chunk_overlap=30).split(item["content_md"] or "")
    vectors = await embedder.embed(chunks)
    records = [
        {"item_id": item["id"], "vector": vectors[i],
         "text": f"{item['title']}\n{chunks[i]}", "keywords": item["title"]}
        for i in range(len(chunks))
    ]
    insert_item_vectors(records)


def delete_item_index(item_id: str) -> None:
    delete_item_vectors(item_id)
