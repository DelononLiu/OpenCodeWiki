import asyncio
import hashlib
import os
from backend.config import Config
from backend.knowledge.chunker import Chunker
from backend.knowledge.embedder import Embedder
from backend.knowledge.vector_store import insert_vectors, _insert_fts5_only
from backend.stores.kb import set_kb_vector_state
from backend.stores.doc import (
    create_chunks_batch, get_chunks_by_doc,
    update_document_status, update_document_chunks_count,
)
from openai import AsyncOpenAI


def compute_hash(file_path: str) -> str:
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            sha.update(chunk)
    return sha.hexdigest()


def _detect_encoding(file_path: str) -> str:
    """Detect file encoding, fall back to utf-8."""
    try:
        import chardet
        with open(file_path, "rb") as f:
            raw = f.read()
        result = chardet.detect(raw)
        return result["encoding"] or "utf-8"
    except Exception:
        return "utf-8"


def parse_file(file_path: str, file_type: str) -> str:
    if file_type in ("md", "txt"):
        enc = _detect_encoding(file_path)
        with open(file_path, "r", encoding=enc, errors="replace") as f:
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


async def import_document(
    doc_id: str,
    file_path: str,
    kb_id: str,
    cfg: Config,
    progress_callback=None,
    cancel_check=None,
    set_ready: bool = True,
) -> None:
    """Import a document: parse → chunk → embed → index.

    Args:
        progress_callback: async callable(percent, message) for progress reporting.
        cancel_check: async callable() → bool; return True to abort early.
    """
    async def _report(pct: int, msg: str = ""):
        if progress_callback:
            await progress_callback(pct, msg)

    def _cancelled() -> bool:
        return cancel_check is not None and cancel_check()

    try:
        # 1. Parse
        ext = os.path.splitext(file_path)[1].lstrip(".").lower()
        text = parse_file(file_path, ext)
        await _report(10, "解析完成")

        if _cancelled():
            update_document_status(doc_id, "cancelled")
            return

        # 2. Chunk
        chunker = Chunker(chunk_size=cfg.knowledge.chunk_size, chunk_overlap=cfg.knowledge.chunk_overlap)
        chunk_texts = chunker.split(text)
        await _report(25, f"已分块: {len(chunk_texts)} 块")

        if _cancelled():
            update_document_status(doc_id, "cancelled")
            return

        # 3. Bulk store chunks in knora.db
        chunk_data = [(ct, i, "{}") for i, ct in enumerate(chunk_texts)]
        db_chunks = create_chunks_batch(doc_id, kb_id, chunk_data)
        await _report(40, "分块已写入")

        # 4. Embed (with retry)
        client = AsyncOpenAI(
            api_key=cfg.embedding.api_key,
            base_url=cfg.embedding.base_url,
        )
        embedder = Embedder(
            client=client,
            model=cfg.embedding.model,
            dimensions=cfg.embedding.dimensions,
        )

        vectors = None
        max_attempts = 2
        for attempt in range(max_attempts):
            if _cancelled():
                update_document_status(doc_id, "cancelled")
                return
            try:
                vectors = await embedder.embed(chunk_texts)
                break
            except Exception as e:
                if attempt < max_attempts - 1:
                    await _report(50, f"嵌入请求失败，正在重试 ({attempt + 1}/{max_attempts})")
                    await asyncio.sleep(1)
                else:
                    raise e

        if vectors:
            # 5. Store in vector DB
            records = [
                {"chunk_id": db_chunks[i]["id"], "vector": vec,
                 "text": chunk_texts[i], "keywords": ""}
                for i, vec in enumerate(vectors)
            ]
            insert_vectors(records)
            await _report(85, "向量写入完成")
        else:
            raise RuntimeError("Embedding returned no vectors after retry")

        # 6. Mark complete
        update_document_chunks_count(doc_id, len(chunk_texts))
        if set_ready:
            set_kb_vector_state(kb_id, "ready")
        await _report(100, "完成")

    except Exception as e:
        update_document_status(doc_id, "failed", str(e))
        raise
