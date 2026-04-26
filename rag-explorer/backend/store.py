"""ChromaDB persistent store wrapper."""
from __future__ import annotations
import os
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any

import chromadb
from chromadb.config import Settings

from embeddings import NomicEmbedder

CHROMA_DIR = Path(os.getenv("CHROMA_DIR", str(Path(__file__).resolve().parent.parent / "chroma_db")))
COLLECTION = os.getenv("CHROMA_COLLECTION", "shopmate_kb")


class VectorStore:
    def __init__(self):
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )
        self.embedder = NomicEmbedder()
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION,
            embedding_function=self.embedder,
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(self, chunks: List[str], source: str, extra: Optional[Dict[str, Any]] = None) -> List[str]:
        if not chunks:
            return []
        ids = [f"{source}::{i}::{uuid.uuid4().hex[:8]}" for i in range(len(chunks))]
        metadatas = [
            {"source": source, "chunk_index": i, "char_count": len(c), **(extra or {})}
            for i, c in enumerate(chunks)
        ]
        self.collection.add(ids=ids, documents=chunks, metadatas=metadatas)
        return ids

    def query(self, text: str, k: int = 4) -> List[Dict[str, Any]]:
        res = self.collection.query(query_texts=[text], n_results=k)
        out: List[Dict[str, Any]] = []
        ids = res.get("ids", [[]])[0]
        docs = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        dists = res.get("distances", [[]])[0]
        for i, doc in enumerate(docs):
            out.append({
                "id": ids[i] if i < len(ids) else None,
                "text": doc,
                "metadata": metas[i] if i < len(metas) else {},
                "distance": dists[i] if i < len(dists) else None,
            })
        return out

    def list_chunks(self, limit: int = 500) -> List[Dict[str, Any]]:
        res = self.collection.get(limit=limit)
        out: List[Dict[str, Any]] = []
        for i, doc in enumerate(res.get("documents", [])):
            out.append({
                "id": res["ids"][i],
                "text": doc,
                "metadata": res["metadatas"][i] if i < len(res.get("metadatas", [])) else {},
            })
        return out

    def stats(self) -> Dict[str, Any]:
        return {
            "collection": self.collection.name,
            "count": self.collection.count(),
            "embedder": self.embedder.name(),
            "persist_dir": str(CHROMA_DIR),
        }

    def reset(self) -> None:
        self.client.delete_collection(self.collection.name)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION,
            embedding_function=self.embedder,
            metadata={"hnsw:space": "cosine"},
        )
