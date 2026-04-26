import { useEffect, useState } from "react";
import ChatbotView from "./components/ChatbotView";
import RagView from "./components/RagView";
import DeepEvalView from "./components/DeepEvalView";

type Tab = "chatbot" | "rag" | "deepeval";

const TABS: Array<{ key: Tab; label: string; subtitle: string; icon: string }> = [
  { key: "chatbot", label: "Chatbot", subtitle: "E-commerce assistant", icon: "💬" },
  { key: "rag", label: "RAG Explorer", subtitle: "Ingest · retrieve · chat", icon: "🧬" },
  { key: "deepeval", label: "DeepEval", subtitle: "Metrics · scores · reports", icon: "📊" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("activeTab") as Tab) || "chatbot");
  const [services, setServices] = useState({ chatbot: false, rag: false });

  useEffect(() => { localStorage.setItem("activeTab", tab); }, [tab]);

  useEffect(() => {
    fetch("/api/health").then(r => r.ok).then(ok => setServices(s => ({ ...s, chatbot: ok }))).catch(() => {});
    fetch("/rag/health").then(r => r.ok).then(ok => setServices(s => ({ ...s, rag: ok }))).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div className="brand-text">
            <div className="brand-title">Deep — LLM Workbench</div>
            <div className="brand-sub">ShopMate · chatbot · RAG · DeepEval, all in one</div>
          </div>
        </div>
        <nav className="top-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`top-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="tt-icon">{t.icon}</span>
              <span className="tt-text">
                <span className="tt-label">{t.label}</span>
                <span className="tt-sub">{t.subtitle}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="services">
          <span className={`svc ${services.chatbot ? "on" : "off"}`} title="ecommerce backend :4000"><i /> :4000</span>
          <span className={`svc ${services.rag ? "on" : "off"}`} title="rag backend :8000"><i /> :8000</span>
        </div>
      </header>

      <div className="view-host">
        {tab === "chatbot" && <ChatbotView />}
        {tab === "rag" && <RagView />}
        {tab === "deepeval" && <DeepEvalView />}
      </div>
    </div>
  );
}
