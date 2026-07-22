from openai import AsyncOpenAI


class Embedder:
    def __init__(self, client: AsyncOpenAI, model: str, dimensions: int, batch_size: int = 32):
        self.client = client
        self.model = model
        self.dimensions = dimensions
        self.batch_size = batch_size

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Batch embed texts, splitting into manageable chunks."""
        all_vectors = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            response = await self.client.embeddings.create(
                model=self.model,
                input=batch,
            )
            all_vectors.extend([d.embedding for d in response.data])
        return all_vectors

    async def embed_single(self, text: str) -> list[float]:
        """Embed a single text."""
        vectors = await self.embed([text])
        return vectors[0]
