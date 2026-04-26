"""Simple recursive text chunker (no external deps beyond stdlib)."""
from __future__ import annotations
from typing import List

DEFAULT_CHUNK_SIZE = 800
DEFAULT_OVERLAP = 120
SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def chunk_text(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_OVERLAP) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]
    return _split(text, chunk_size, overlap, SEPARATORS)


def _split(text: str, size: int, overlap: int, seps: List[str]) -> List[str]:
    if len(text) <= size:
        return [text]

    sep = next((s for s in seps if s and s in text), "")
    parts = text.split(sep) if sep else list(text)

    chunks: List[str] = []
    buf = ""
    for part in parts:
        candidate = (buf + sep + part) if buf else part
        if len(candidate) <= size:
            buf = candidate
        else:
            if buf:
                chunks.append(buf)
            if len(part) > size:
                chunks.extend(_split(part, size, overlap, seps[seps.index(sep) + 1:] if sep in seps else seps))
                buf = ""
            else:
                buf = part
    if buf:
        chunks.append(buf)

    if overlap > 0 and len(chunks) > 1:
        merged: List[str] = []
        for i, c in enumerate(chunks):
            if i == 0:
                merged.append(c)
            else:
                tail = chunks[i - 1][-overlap:]
                merged.append(tail + " " + c)
        chunks = merged
    return chunks
