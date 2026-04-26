import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Chunk = { id: string; text: string; metadata: { source: string; chunk_index: number; char_count: number } };
type Stats = { count: number; collection: string; embedder: string; model: string };
type Retrieved = { id: string; text: string; metadata: any; distance: number };
type ChatMsg = { role: "user" | "assistant"; content: string; retrieved?: Retrieved[] };
type Tab = "chunks" | "chat";

export default function App() {
  const [tab, setTab] = useState<Tab>("chunks");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => {
    const map = new Map<string, number>();
    chunks.forEach(c => map.set(c.metadata.source, (map.get(c.metadata.source) || 0) + 1));
    return [...map.entries()].sort();
  }, [chunks]);

  const visibleChunks = useMemo(
    () => activeSource ? chunks.filter(c => c.metadata.source === activeSource) : chunks,
    [chunks, activeSource]
  );

  async function refresh() {
    const [c, s] = await Promise.all([
      fetch("/api/chunks").then(r => r.json()),
      fetch("/api/health").then(r => r.json())
    ]);
    setChunks(c.chunks || []);
    setStats(s);
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
      const r = await fetch("/api/ingest", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "upload failed");
      flash("success", `Ingested ${file.name}: ${d.chunks_created} chunks`);
      await refresh();
    } catch (e: any) {
      flash("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function seed() {
    setBusy(true);
    try {
      const r = await fetch("/api/ingest/seed", { method: "POST" });
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
      await fetch("/api/collection", { method: "DELETE" });
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
    setMessages(next);
    setInput("");
    setChatLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, k: 4 })
      });
      const d = await r.json();
      setMessages([...next, { role: "assistant", content: d.answer || "(no answer)", retrieved: d.retrieved_context || [] }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally { setChatLoading(false); }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">🧬 RAG Explorer</div>
        <div className="stats">
          <span>📦 <b>{stats?.count ?? 0}</b> chunks</span>
          <span>🧮 {stats?.embedder ?? "—"}</span>
          <span>🤖 {stats?.model ?? "—"}</span>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === "chunks" ? "active" : ""}`} onClick={() => setTab("chunks")}>Chunks</button>
          <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>Chat (RAG)</button>
        </div>
      </div>

      <aside className="sidebar">
        <div className="section-title">Ingest</div>
        <label className="upload" onClick={() => fileInput.current?.click()}>
          <div className="icon">⬆</div>
          <div className="label">Drop a PDF or .txt<br/>or click to browse</div>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt"
            onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])}
          />
        </label>
        <button className="btn ghost" disabled={busy} onClick={seed}>📚 Seed sample docs</button>
        <button className="btn danger" disabled={busy} onClick={clearAll}>🗑 Clear collection</button>

        <div className="section-title" style={{ marginTop: 22 }}>Sources ({sources.length})</div>
        <div className="source-list">
          <div
            className={`source-item ${activeSource === null ? "active" : ""}`}
            onClick={() => setActiveSource(null)}
          >
            <span>All</span><span className="count">{chunks.length}</span>
          </div>
          {sources.map(([src, n]) => (
            <div
              key={src}
              className={`source-item ${activeSource === src ? "active" : ""}`}
              onClick={() => setActiveSource(src)}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src}</span>
              <span className="count">{n}</span>
            </div>
          ))}
        </div>
        <div className="section-title" style={{ marginTop: 22 }}>Open in browser</div>
        <a className="btn ghost" href="http://localhost:8000/chunks/html" target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none", textAlign: "center" }}>
          🌐 HTML chunks view
        </a>
      </aside>

      <main className="main">
        {tab === "chunks" ? (
          <div className="chunks-pane">
            {visibleChunks.length === 0 ? (
              <div className="empty">
                <div className="em">📭</div>
                <div>No chunks yet — upload a file or click Seed sample docs.</div>
              </div>
            ) : visibleChunks.map(c => (
              <article key={c.id} className="chunk">
                <header>
                  <span className="src">{c.metadata.source}</span>
                  <span className="idx">#chunk {c.metadata.chunk_index}</span>
                  <span>{c.metadata.char_count} chars</span>
                  <span style={{ marginLeft: "auto", color: "#475569" }}>{c.id}</span>
                </header>
                <pre>{c.text}</pre>
              </article>
            ))}
          </div>
        ) : (
          <div className="chat-pane">
            <div className="chat-msgs" ref={chatScroll}>
              {messages.length === 0 && (
                <div className="empty" style={{ margin: "auto", color: "#64748b", textAlign: "center" }}>
                  <h2 style={{ color: "#cbd5e1" }}>💬 Ask the RAG agent</h2>
                  <p>Questions are answered from your ingested documents only.</p>
                </div>
              )}
              {messages.map((m, i) => (
                <Fragment key={i}>
                  <div className={`bubble ${m.role === "user" ? "user" : "bot"}`}>
                    {m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
                  </div>
                  {m.retrieved && m.retrieved.length > 0 && (
                    <details className="retrieved">
                      <summary>📑 {m.retrieved.length} retrieved chunks</summary>
                      {m.retrieved.map((h, j) => (
                        <div key={j} className="ctx-item">
                          <div className="ctx-meta">{h.metadata?.source} #chunk{h.metadata?.chunk_index} · distance {h.distance?.toFixed(3)}</div>
                          {h.text.slice(0, 280)}{h.text.length > 280 ? "…" : ""}
                        </div>
                      ))}
                    </details>
                  )}
                </Fragment>
              ))}
              {chatLoading && <div className="bubble bot" style={{ fontStyle: "italic", color: "#94a3b8" }}>Retrieving + generating…</div>}
            </div>
            <div className="composer">
              <input
                value={input}
                placeholder="Ask about returns, shipping, products, warranty..."
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()}
                disabled={chatLoading}
              />
              <button onClick={send} disabled={chatLoading || !input.trim()}>Ask</button>
            </div>
          </div>
        )}
      </main>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
