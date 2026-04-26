import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Chunk = { id: string; text: string; metadata: { source: string; chunk_index: number; char_count: number } };
type Stats = { count: number; collection: string; embedder: string; model: string };
type Retrieved = { id: string; text: string; metadata: any; distance: number };
type ChatMsg = { role: "user" | "assistant"; content: string; retrieved?: Retrieved[] };
type RagTab = "dashboard" | "ingest" | "search" | "chat";

const STAGES = [
  { n: 1, title: "Ingest", body: "Load .pdf or .txt files; split into ~800-char chunks with overlap.", chips: [".pdf", ".txt"] },
  { n: 2, title: "Embed", body: "Local Ollama nomic-embed-text (768-dim).", chips: ["http://localhost:11434"] },
  { n: 3, title: "Store", body: "ChromaDB persistent collection, cosine distance.", chips: ["shopmate_kb"] },
  { n: 4, title: "Retrieve", body: "Top-k semantic search returns chunks with similarity scores.", chips: [] },
  { n: 5, title: "Answer", body: "Groq LLM grounds its reply in retrieved chunks; cites sources.", chips: [] },
];

export default function RagView() {
  const [tab, setTab] = useState<RagTab>("dashboard");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<any[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    chunks.forEach(c => m.set(c.metadata.source, (m.get(c.metadata.source) || 0) + 1));
    return [...m.entries()].sort();
  }, [chunks]);

  async function refresh() {
    try {
      const [c, s] = await Promise.all([
        fetch("/rag/chunks").then(r => r.json()),
        fetch("/rag/health").then(r => r.json()),
      ]);
      setChunks(c.chunks || []);
      setStats(s);
    } catch {
      flash("error", "RAG backend unreachable");
    }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" }); }, [messages, chatLoading]);

  function flash(kind: "success" | "error", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2800);
  }

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/rag/ingest", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "upload failed");
      flash("success", `Ingested ${file.name}: ${d.chunks_created} chunks`);
      await refresh();
    } catch (e: any) { flash("error", e.message); }
    finally { setBusy(false); }
  }

  async function seed() {
    setBusy(true);
    try {
      const r = await fetch("/rag/ingest/seed", { method: "POST" });
      const d = await r.json();
      flash("success", `Seeded ${d.total_files} files`);
      await refresh();
    } catch (e: any) { flash("error", e.message); }
    finally { setBusy(false); }
  }

  async function clearAll() {
    if (!confirm("Clear the entire collection?")) return;
    setBusy(true);
    try {
      await fetch("/rag/collection", { method: "DELETE" });
      flash("success", "Collection cleared");
      setActiveSource(null);
      await refresh();
    } catch (e: any) { flash("error", e.message); }
    finally { setBusy(false); }
  }

  async function send() {
    const q = input.trim();
    if (!q || chatLoading) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next); setInput(""); setChatLoading(true);
    try {
      const r = await fetch("/rag/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, k: 4 }),
      });
      const d = await r.json();
      setMessages([...next, { role: "assistant", content: d.answer || "(no answer)", retrieved: d.retrieved_context || [] }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally { setChatLoading(false); }
  }

  async function runSearch() {
    if (!searchQ.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/rag/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQ, k: 5 }),
      });
      const d = await r.json();
      setSearchHits(d.results || []);
    } catch (e: any) { flash("error", e.message); }
    finally { setBusy(false); }
  }

  const visibleChunks = activeSource ? chunks.filter(c => c.metadata.source === activeSource) : chunks;

  return (
    <div className="rag-view">
      <div className="rag-stage">
        <header className="rag-headline">
          <div>
            <h1>RAG Explorer</h1>
            <div className="lede">Ingest · Embed · Search · Answer · Evaluate — a complete local-first RAG pipeline you can inspect at every stage.</div>
          </div>
          <nav className="rag-sub-tabs">
            {(["dashboard", "ingest", "search", "chat"] as RagTab[]).map(t => (
              <button key={t} className={`rag-sub-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
        </header>

        {tab === "dashboard" && (
          <>
            <h2 style={{ fontSize: 22, margin: "20px 0 6px" }}>Pipeline status</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>Documents flow left-to-right; click Open to inspect each stage.</p>
            <section className="pipeline">
              {STAGES.map(s => (
                <div className="stage" key={s.n}>
                  <div className="stage-num">{s.n}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  {s.chips.length > 0 && (
                    <div className="chips">{s.chips.map(c => <span className="code-chip" key={c}>{c}</span>)}</div>
                  )}
                  <button className="open-btn" onClick={() => setTab(
                    s.title === "Ingest" ? "ingest" :
                    s.title === "Retrieve" ? "search" :
                    s.title === "Answer" ? "chat" : "dashboard"
                  )}>Open</button>
                </div>
              ))}
            </section>

            <section className="rag-pair">
              <div className="rag-card">
                <h3>Vector store</h3>
                <div className="kv-row"><div className="k">Collection</div><div className="v">{stats?.collection || "—"}</div></div>
                <div className="kv-row"><div className="k">Total chunks</div><div className="v">{stats?.count ?? 0}</div></div>
                <div className="kv-row"><div className="k">Distinct sources</div><div className="v">{sources.length}</div></div>
                <div className="kv-row"><div className="k">Embedder</div><div className="v">{stats?.embedder ?? "—"}</div></div>
                <div className="kv-row"><div className="k">Generator</div><div className="v">{stats?.model ?? "—"}</div></div>
                <div className="kv-row"><div className="k">Groq configured</div><div className="v green">yes</div></div>
              </div>
              <div className="rag-card">
                <h3>Sources ({sources.length})</h3>
                {sources.length === 0 ? (
                  <div className="muted">No documents yet. Click <b>Seed sample docs</b> on the Ingest tab to populate.</div>
                ) : sources.map(([src, n]) => (
                  <div className="source-row" key={src}>
                    <span className="name">{src}</span>
                    <span className="count">{n} chunks</span>
                  </div>
                ))}
              </div>
            </section>

            <div className="rag-footer">RAG Explorer · ChromaDB + Nomic Embed (Ollama) + Groq · Evaluated by DeepEval</div>
          </>
        )}

        {tab === "ingest" && (
          <>
            <div className="rag-toolbar">
              <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={busy}>⬆ Upload PDF / .txt</button>
              <input ref={fileInput} type="file" accept=".pdf,.txt" onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              <button className="btn" onClick={seed} disabled={busy}>📚 Seed sample docs</button>
              <button className="btn danger" onClick={clearAll} disabled={busy}>🗑 Clear</button>
              <span className="muted" style={{ marginLeft: 8 }}>{stats?.count ?? 0} chunks across {sources.length} sources</span>
            </div>

            <div className="rag-toolbar" style={{ marginTop: 0 }}>
              <button className={`cat-chip ${activeSource === null ? "active" : ""}`} onClick={() => setActiveSource(null)}>All</button>
              {sources.map(([src, n]) => (
                <button key={src} className={`cat-chip ${activeSource === src ? "active" : ""}`} onClick={() => setActiveSource(src)}>
                  {src} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span>
                </button>
              ))}
            </div>

            {visibleChunks.length === 0 ? (
              <div className="empty-state"><div className="em">📭</div><p>No chunks yet — upload a file or click <b>Seed sample docs</b>.</p></div>
            ) : visibleChunks.map(c => (
              <article key={c.id} className="chunk">
                <header className="chunk-header">
                  <span className="src">{c.metadata.source}</span>
                  <span className="idx">#chunk {c.metadata.chunk_index}</span>
                  <span className="muted">{c.metadata.char_count} chars</span>
                  <span className="chunk-id">{c.id}</span>
                </header>
                <pre className="chunk-text">{c.text}</pre>
              </article>
            ))}
          </>
        )}

        {tab === "search" && (
          <>
            <div className="rag-toolbar">
              <input
                placeholder="Search the vector store…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runSearch()}
                style={{ flex: 1, padding: "9px 13px", background: "var(--cream-2)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 14, outline: "none" }}
              />
              <button className="btn" onClick={runSearch} disabled={busy}>Search</button>
            </div>
            {searchHits === null ? (
              <div className="empty-state small"><p>Try: <i>“how long do I have to return things?”</i> or <i>“warranty for headphones”</i>.</p></div>
            ) : searchHits.length === 0 ? (
              <div className="empty-state small"><p>No matches.</p></div>
            ) : searchHits.map((h: any, i: number) => (
              <article key={i} className="chunk">
                <header className="chunk-header">
                  <span className="src">{h.metadata?.source}</span>
                  <span className="idx">#chunk {h.metadata?.chunk_index}</span>
                  <span className="muted">distance {(h.distance ?? 0).toFixed(3)}</span>
                  <span className="chunk-id">{h.id}</span>
                </header>
                <pre className="chunk-text">{h.text}</pre>
              </article>
            ))}
          </>
        )}

        {tab === "chat" && (
          <div className="rag-chat">
            <div className="cb-messages" ref={chatScroll} style={{ minHeight: 480, padding: "20px 0" }}>
              {messages.length === 0 && (
                <div className="empty-state"><div className="em">💬</div><h3>Ask the RAG agent</h3><p>Answers are grounded in your ingested documents.</p></div>
              )}
              {messages.map((m, i) => (
                <Fragment key={i}>
                  <div className={`cb-row ${m.role === "user" ? "user" : "bot"}`}>
                    {m.role !== "user" && <div className="cb-avatar">🤖</div>}
                    <div className="cb-bubble">
                      {m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
                    </div>
                    {m.role === "user" && <div className="cb-avatar">🙂</div>}
                  </div>
                  {m.retrieved && m.retrieved.length > 0 && (
                    <details className="retrieved" style={{ marginLeft: 40 }}>
                      <summary>📑 {m.retrieved.length} retrieved chunks</summary>
                      {m.retrieved.map((h, j) => (
                        <div key={j} className="ctx-item">
                          <div className="ctx-meta">{h.metadata?.source} · chunk {h.metadata?.chunk_index} · distance {h.distance?.toFixed(3)}</div>
                          {h.text.slice(0, 300)}{h.text.length > 300 ? "…" : ""}
                        </div>
                      ))}
                    </details>
                  )}
                </Fragment>
              ))}
              {chatLoading && <div className="cb-row bot"><div className="cb-avatar">🤖</div><div className="cb-bubble" style={{ fontStyle: "italic", color: "var(--ink-3)" }}>retrieving + generating…</div></div>}
            </div>
            <div className="cb-composer">
              <input value={input} placeholder="Ask about returns, shipping, products, warranty…" onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={chatLoading} />
              <button onClick={send} disabled={chatLoading || !input.trim()}>Ask</button>
            </div>
          </div>
        )}
      </div>
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
