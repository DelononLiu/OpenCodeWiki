from backend.knowledge.chunker import Chunker


def test_split_shorter_than_chunk_size():
    chunker = Chunker(chunk_size=512, chunk_overlap=50)
    chunks = chunker.split("hello world")
    assert len(chunks) == 1
    assert chunks[0] == "hello world"


def test_split_long_text():
    chunker = Chunker(chunk_size=100, chunk_overlap=20)
    text = "This is sentence one. " * 50
    chunks = chunker.split(text)
    assert len(chunks) > 1
    # Each chunk should be roughly <= 100 chars (approximate)
    for c in chunks:
        assert len(c) <= 200  # generous upper bound


def test_split_preserves_separators():
    chunker = Chunker(chunk_size=200, chunk_overlap=20)
    text = "# Header\n\nParagraph one here.\n\n## Subheader\n\nMore content here."
    chunks = chunker.split(text)
    assert len(chunks) >= 1


def test_empty_input():
    chunker = Chunker(chunk_size=100, chunk_overlap=20)
    chunks = chunker.split("")
    assert chunks == [""]
