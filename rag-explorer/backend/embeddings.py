"""Nomic-embed-text via local Ollama HTTP API."""
import os
from typing import List
import httpx

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")


class NomicEmbedder:
    """ChromaDB-compatible embedding function backed by Ollama."""

    def __init__(self, model: str = EMBED_MODEL, base_url: str = OLLAMA_URL):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(timeout=60.0)

    def __call__(self, input: List[str]) -> List[List[float]]:
        return self.embed(input)

    def embed(self, texts: List[str]) -> List[List[float]]:
        out: List[List[float]] = []
        for t in texts:
            r = self._client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": t},
            )
            r.raise_for_status()
            out.append(r.json()["embedding"])
        return out

    def name(self) -> str:
        return f"ollama:{self.model}"
