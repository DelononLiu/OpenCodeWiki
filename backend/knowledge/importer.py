import asyncio
import hashlib
import os
from backend.config import Config
from backend.knowledge.chunker import Chunker
from backend.knowledge.embedder import Embedder
from backend.knowledge.vector_store import insert_vectors
from backend.stores.doc import (
    create_chunk, update_document_status, update_document_chunks_count,
)
from openai import AsyncOpenAI


def compute_hash(file_path: str) -> str:
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            sha.update(chunk)
    return sha.hexdigest()


def parse_file(file_path: str, file_type: str) -> str:
    if file_type in ("md", "txt"):
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    elif file_type == "pdf":
        import fitz  # pymupdf
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text
    elif file_type == "docx":
        from docx import Document
        doc = Document(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")


async def import_document(doc_id: str, file_path: str, kb_id: str, cfg: Config) -> None:
    try:
        # 1. Parse
        ext = os.path.splitext(file_path)[1].lstrip(".").lower()
        text = parse_file(file_path, ext)

        # 2. Chunk
        chunker = Chunker(chunk_size=cfg.knowledge.chunk_size, chunk_overlap=cfg.knowledge.chunk_overlap)
        chunk_texts = chunker.split(text)

        # 3. Store chunks in knora.db
        for i, ct in enumerate(chunk_texts):
            create_chunk(doc_id, kb_id, ct, i, "{}")

        # 4. Embed
        client = AsyncOpenAI(
            api_key=cfg.embedding.api_key,
            base_url=cfg.embedding.base_url,
        )
        embedder = Embedder(
            client=client,
            model=cfg.embedding.model,
            dimensions=cfg.embedding.dimensions,
        )
        vectors = await embedder.embed(chunk_texts)

        # 5. Store in vector DB
        records = [
            {
                "chunk_id": f"chk-import-{i}",
                "vector": vec,
                "text": chunk_texts[i],
                "keywords": "",
            }
            for i, vec in enumerate(vectors)
        ]
        # Fix chunk IDs to match actual DB records
        from backend.stores.doc import get_chunks_by_doc
        db_chunks = get_chunks_by_doc(doc_id)
        for i, ch in enumerate(db_chunks):
            if i < len(records):
                records[i]["chunk_id"] = ch["id"]

        insert_vectors(records)

        # 6. Mark complete
        update_document_chunks_count(doc_id, len(chunk_texts))

    except Exception as e:
        update_document_status(doc_id, "failed", str(e))
