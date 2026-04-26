import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string };

const SUGGESTIONS = [
  "What's your refund policy?",
  "How long does standard shipping take?",
  "Tell me about the Aurora headphones.",
  "How do I reset my password?",
  "Can I return a hoodie after 35 days?",
];

export default function ChatbotView() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! I'm ShopBot, your ShopMate support assistant. Ask me about orders, shipping, refunds, or products." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(d => setModel(d.model || "")).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as Role, content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter(m => m.role !== "assistant" || m !== next[0]) }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "(no response)" }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chatbot-view">
      <div className="chatbot-stage">
        <div className="cb-card">
          <header className="cb-header">
            <div className="cb-mark" />
            <div>
              <div className="cb-title">ShopMate</div>
              <div className="cb-sub">Customer Support · ShopBot</div>
            </div>
            <div className="cb-status">
              <i /> {model || "connecting…"}
            </div>
          </header>

          <div className="cb-messages" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`cb-row ${m.role === "user" ? "user" : "bot"}`}>
                {m.role !== "user" && <div className="cb-avatar">🤖</div>}
                <div className="cb-bubble">
                  {m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
                </div>
                {m.role === "user" && <div className="cb-avatar">🙂</div>}
              </div>
            ))}
            {loading && (
              <div className="cb-row bot">
                <div className="cb-avatar">🤖</div>
                <div className="cb-bubble" style={{ fontStyle: "italic", color: "var(--ink-3)" }}>typing…</div>
              </div>
            )}
          </div>

          <div className="cb-suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="cb-chip" onClick={() => send(s)} disabled={loading}>
                {s}
              </button>
            ))}
          </div>

          <div className="cb-composer">
            <input
              value={input}
              placeholder="Ask about orders, shipping, refunds, products…"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              disabled={loading}
            />
            <button onClick={() => send()} disabled={loading || !input.trim()}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
