"""RAG Explorer FastAPI backend.

Endpoints:
- GET  /health
- POST /ingest          (multipart file upload, .pdf or .txt)
- POST /ingest/seed     (ingest data/ folder)
- GET  /chunks          (list chunks, optional source filter)
- GET  /chunks/html     (HTML rendering of chunks)
- POST /query           (RAG retrieve)
- POST /chat            (RAG retrieve + Groq generation)
- DELETE /collection    (reset store)
- GET  /stats
"""
from __future__ import annotations
import os
import io
import json
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from groq import Groq
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")

from chunker import chunk_text  # noqa: E402
from store import VectorStore   # noqa: E402

app = FastAPI(title="RAG Explorer", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = VectorStore()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "llama-3.3-70b-versatile")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

SYSTEM_PROMPT = """You are ShopMate's RAG-powered support assistant. Answer questions using ONLY the context passages provided. If the answer is not in the context, say "I don't have that in my knowledge base — please contact support@shopmate.example."

Hard rules — follow exactly:
- Cite the source filename inline in square brackets after EVERY factual claim, like: "Returns are accepted within 30 days [03_returns_policy.txt]."
- Every sentence that states a fact must end with at least one such [filename.txt] citation.
- Be concise: 1-4 sentences. Never exceed 5 sentences.
- Never invent prices, policies, SKUs, or warranty terms.
- If context is contradictory, surface the contradiction (still cited)."""


class QueryReq(BaseModel):
    query: str
    k: int = 4


class ChatReq(BaseModel):
    message: str
    k: int = 4
    history: Optional[List[dict]] = None


@app.get("/health")
def health():
    return {"status": "ok", "model": CHAT_MODEL, **store.stats()}


@app.get("/stats")
def stats():
    return store.stats()


def _read_file(name: str, content: bytes) -> str:
    lower = name.lower()
    if lower.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join((p.extract_text() or "") for p in reader.pages)
    return content.decode("utf-8", errors="ignore")


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    if not (file.filename.lower().endswith(".pdf") or file.filename.lower().endswith(".txt")):
        raise HTTPException(400, "Only .pdf and .txt are supported")
    content = await file.read()
    text = _read_file(file.filename, content)
    chunks = chunk_text(text)
    ids = store.add_chunks(chunks, source=file.filename)
    return {
        "source": file.filename,
        "chars": len(text),
        "chunks_created": len(chunks),
        "ids": ids,
    }


@app.post("/ingest/seed")
def ingest_seed():
    if not DATA_DIR.exists():
        raise HTTPException(404, f"Seed dir not found: {DATA_DIR}")
    out = []
    for path in sorted(DATA_DIR.iterdir()):
        if path.suffix.lower() not in {".txt", ".pdf"}:
            continue
        text = _read_file(path.name, path.read_bytes())
        chunks = chunk_text(text)
        ids = store.add_chunks(chunks, source=path.name)
        out.append({"source": path.name, "chars": len(text), "chunks_created": len(chunks), "ids_sample": ids[:2]})
    return {"ingested": out, "total_files": len(out), **store.stats()}


@app.get("/chunks")
def list_chunks(source: Optional[str] = None, limit: int = 500):
    items = store.list_chunks(limit=limit)
    if source:
        items = [c for c in items if c["metadata"].get("source") == source]
    return {"count": len(items), "chunks": items}


@app.get("/chunks/html", response_class=HTMLResponse)
def chunks_html(source: Optional[str] = None, limit: int = 500):
    items = store.list_chunks(limit=limit)
    if source:
        items = [c for c in items if c["metadata"].get("source") == source]
    rows = []
    for c in items:
        meta = c["metadata"]
        rows.append(f"""
        <article class="chunk">
          <header>
            <span class="src">{meta.get('source','?')}</span>
            <span class="idx">#chunk {meta.get('chunk_index','?')}</span>
            <span class="len">{meta.get('char_count','?')} chars</span>
            <span class="id">{c['id']}</span>
          </header>
          <pre>{(c['text'] or '').replace('<','&lt;').replace('>','&gt;')}</pre>
        </article>
        """)
    body = "".join(rows) or "<p class='empty'>No chunks. Run /ingest/seed first.</p>"
    html = f"""<!doctype html><html><head><meta charset='utf-8'><title>Chunks ({len(items)})</title>
    <style>
    body{{font-family:-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;}}
    h1{{margin:0 0 16px;font-size:18px;color:#93c5fd;}}
    .chunk{{background:#1e293b;border:1px solid #334155;border-radius:8px;margin:0 0 12px;padding:14px;}}
    header{{display:flex;gap:14px;font-size:11px;color:#94a3b8;margin-bottom:8px;flex-wrap:wrap;}}
    .src{{color:#34d399;font-weight:600;}}
    .idx{{color:#a78bfa;}}
    pre{{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;margin:0;color:#cbd5e1;}}
    .empty{{color:#64748b;font-style:italic;}}
    </style></head><body>
    <h1>Chunks ({len(items)})</h1>{body}</body></html>"""
    return html


@app.post("/query")
def query(req: QueryReq):
    hits = store.query(req.query, k=req.k)
    return {"query": req.query, "k": req.k, "results": hits}


@app.post("/chat")
def chat(req: ChatReq):
    hits = store.query(req.message, k=req.k)
    context_block = "\n\n".join(
        f"[Source: {h['metadata'].get('source','?')} #chunk{h['metadata'].get('chunk_index','?')}]\n{h['text']}"
        for h in hits
    )
    user_prompt = f"Context:\n{context_block}\n\nUser question: {req.message}"
    history = req.history or []
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history, {"role": "user", "content": user_prompt}]
    completion = groq_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        temperature=0.2,
        max_tokens=600,
    )
    answer = completion.choices[0].message.content
    return {
        "answer": answer,
        "model": CHAT_MODEL,
        "retrieved_context": hits,
        "k": req.k,
    }


@app.delete("/collection")
def clear():
    store.reset()
    return {"status": "cleared", **store.stats()}


# ---------- DeepEval results passthrough ---------- #
EVAL_REPORTS = Path(__file__).resolve().parent.parent.parent / "deepeval-framework" / "reports"


@app.get("/eval/data")
def eval_data():
    """Return whatever eval JSONs exist so the unified UI can render the dashboard."""
    out = {"chatbot": None, "rag": None, "config": None, "available": []}
    for key, fname in [("chatbot", "chatbot_results.json"), ("rag", "rag_results.json")]:
        p = EVAL_REPORTS / fname
        if p.exists():
            payload = json.loads(p.read_text())
            out[key] = payload
            out["available"].append(key)
            if not out["config"]:
                out["config"] = payload.get("config", {})
    return out
