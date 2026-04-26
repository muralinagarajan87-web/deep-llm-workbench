import { useEffect, useMemo, useRef, useState } from "react";

type Metric = {
  id: string;
  name: string;
  category: "Quality" | "Retrieval" | "Safety" | "G-Eval" | "Conversational";
  target: "chatbot" | "rag";
  threshold: number;
  threshold_op: string;
  description: string;
  needs_retrieval?: boolean;
  last_result?: Result | null;
};
type Result = {
  status: "pass" | "fail" | "error";
  score: number | null;
  threshold: number;
  threshold_op: string;
  reason: string;
  judge_model: string;
  metric_latency_ms: number;
  api_latency_ms: number;
  input: string;
  actual_output: string;
  expected_output: string;
  retrieval_context: string[];
  ts: number;
  traceback?: string;
};
type Counters = { pass: number; fail: number; error: number; pending: number };
type Judge = { provider: string; model: string; name: string | null };

const CATEGORIES = ["All", "Quality", "Retrieval", "Safety", "G-Eval", "Conversational"] as const;
type Cat = typeof CATEGORIES[number];
const TARGETS = ["all", "chatbot", "rag"] as const;
type Target = typeof TARGETS[number];

export default function DeepEvalView() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [counters, setCounters] = useState<Counters>({ pass: 0, fail: 0, error: 0, pending: 0 });
  const [judge, setJudge] = useState<Judge>({ provider: "groq", model: "llama-3.1-8b-instant", name: "groq/llama-3.1-8b-instant" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCat, setActiveCat] = useState<Cat>("All");
  const [activeTarget, setActiveTarget] = useState<Target>("all");
  const [judgeProvider, setJudgeProvider] = useState("groq");
  const [judgeModel, setJudgeModel] = useState("llama-3.1-8b-instant");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ active: boolean; runId: string | null; total: number; completed: number; current: string | null }>({
    active: false, runId: null, total: 0, completed: 0, current: null,
  });
  const [detail, setDetail] = useState<{ metric: Metric; result: Result } | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  async function load() {
    try {
      const r = await fetch("/eval/metrics");
      if (!r.ok) throw new Error("failed");
      const d = await r.json();
      setMetrics(d.metrics);
      setCounters(d.counters);
      setJudge(d.judge);
      setError(null);
    } catch (e: any) {
      setError("Test runner not running on :9000. Start it with `uvicorn runner_service:app --port 9000` from `deepeval-framework/`.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // --- SSE live progress ---
  useEffect(() => {
    const es = new EventSource("/eval/events");
    sseRef.current = es;
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "snapshot") {
          setRunning(new Set(m.running || []));
          setCounters(m.counters);
        } else if (m.type === "batch_start") {
          setBatch({ active: true, runId: m.run_id, total: m.total, completed: 0, current: null });
        } else if (m.type === "metric_start") {
          setRunning(prev => { const n = new Set(prev); n.add(m.metric_id); return n; });
          setBatch(prev => prev.active ? { ...prev, current: m.metric_id, completed: m.completed ?? prev.completed, total: m.total ?? prev.total } : prev);
        } else if (m.type === "metric_done") {
          setRunning(prev => { const n = new Set(prev); n.delete(m.metric_id); return n; });
          setMetrics(prev => prev.map(x => x.id === m.metric_id ? { ...x, last_result: m.result } : x));
          if (m.counters) setCounters(m.counters);
          setBatch(prev => prev.active ? { ...prev, completed: m.completed ?? prev.completed, total: m.total ?? prev.total } : prev);
        } else if (m.type === "batch_done") {
          setBatch({ active: false, runId: null, total: 0, completed: 0, current: null });
          if (m.counters) setCounters(m.counters);
        }
      } catch (e) { /* ignore parse errors on keep-alive */ }
    };
    es.onerror = () => { /* auto-reconnects */ };
    return () => { es.close(); sseRef.current = null; };
  }, []);

  const filtered = useMemo(() => metrics.filter(m =>
    (activeCat === "All" || m.category === activeCat)
    && (activeTarget === "all" || m.target === activeTarget)
  ), [metrics, activeCat, activeTarget]);

  async function runOne(m: Metric) {
    if (running.has(m.id) || batch.active) return;
    setRunning(prev => { const n = new Set(prev); n.add(m.id); return n; });
    setMetrics(prev => prev.map(x => x.id === m.id ? { ...x, last_result: null } : x));
    try {
      const r = await fetch("/eval/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric_id: m.id }),
      });
      const d = await r.json();
      // SSE will also update — but set here for instant feedback
      setMetrics(prev => prev.map(x => x.id === m.id ? { ...x, last_result: d.result } : x));
      if (d.counters) setCounters(d.counters);
    } finally {
      setRunning(prev => { const n = new Set(prev); n.delete(m.id); return n; });
    }
  }

  async function runAllVisible() {
    if (filtered.length === 0 || batch.active) return;
    await fetch("/eval/run-batch-async", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric_ids: filtered.map(m => m.id) }),
    });
    // SSE will drive the UI from here
  }

  async function applyJudge() {
    try {
      const r = await fetch("/eval/judge/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: judgeProvider, model: judgeModel || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "failed");
      setJudge(d.judge);
      await load();
    } catch (e: any) {
      alert(`Judge apply failed: ${e.message}`);
    }
  }

  if (loading) return <div className="deepeval-view"><div className="empty-state"><div className="em">⏳</div><p>Loading metrics…</p></div></div>;
  if (error) return <div className="deepeval-view"><div className="empty-state"><div className="em">⚠️</div><h3>Test runner offline</h3><p style={{ maxWidth: 540 }}>{error}</p></div></div>;

  const currentMetric = batch.current ? metrics.find(m => m.id === batch.current) : null;
  const batchPct = batch.total > 0 ? (batch.completed / batch.total) * 100 : 0;

  return (
    <div className="deepeval-view">
      <div className="de-stage">
        <header className="de-headline">
          <div className="left">
            <h1>DeepEval Dashboard</h1>
            <p>Live metric runs against the chatbot and RAG pipeline.</p>
          </div>
          <div className="controls">
            <div className="field">
              <label>Target</label>
              <select value={activeTarget} onChange={e => setActiveTarget(e.target.value as Target)}>
                <option value="all">All</option>
                <option value="chatbot">Chatbot</option>
                <option value="rag">RAG</option>
              </select>
            </div>
            <div className="field">
              <label>Judge LLM</label>
              <select value={judgeProvider} onChange={e => setJudgeProvider(e.target.value)}>
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>
            <div className="field">
              <label>Judge model</label>
              <input value={judgeModel} placeholder="auto" onChange={e => setJudgeModel(e.target.value)} />
            </div>
            <button className="btn ghost" onClick={applyJudge} disabled={batch.active}>Apply judge</button>
            <button className="btn icon-play big" onClick={runAllVisible} disabled={batch.active || filtered.length === 0}>
              {batch.active ? `Running ${batch.completed}/${batch.total}…` : `Run all visible (${filtered.length})`}
            </button>
          </div>
        </header>

        {batch.active && (
          <div className="batch-banner">
            <div className="batch-banner-row">
              <div className="batch-status">
                <span className="spinner" />
                <span>
                  Running batch — <b>{batch.completed} / {batch.total}</b>
                  {currentMetric && <> · current: <span className="batch-current">{currentMetric.name}</span> <span className="batch-target">({currentMetric.target})</span></>}
                </span>
              </div>
              <span className="batch-pct">{Math.round(batchPct)}%</span>
            </div>
            <div className="batch-bar"><div style={{ width: `${batchPct}%` }} /></div>
          </div>
        )}

        <section className="de-status-row">
          <div className="de-status">
            <span className="dot" />
            <div className="text"><span className="lbl">Chatbot</span><span className="val">http://localhost:4000</span></div>
          </div>
          <div className="de-status">
            <span className="dot" />
            <div className="text"><span className="lbl">RAG</span><span className="val">http://localhost:8000</span></div>
          </div>
          <div className="de-status">
            <span className="dot" />
            <div className="text"><span className="lbl">Judge</span><span className="val">{judge?.provider} · {judge?.name || judge?.model}</span></div>
          </div>
          <div className="de-status counters">
            <div className="text"><span className="lbl">pass · fail · pending</span></div>
            <div className="pills">
              <span className="counter-pill pass">{counters.pass}</span>
              <span className="counter-pill fail">{counters.fail + counters.error}</span>
              <span className="counter-pill pending">{counters.pending}</span>
            </div>
          </div>
        </section>

        <section className="de-categories">
          <span className="label">Categories:</span>
          {CATEGORIES.map(c => (
            <button key={c} className={`cat-chip ${activeCat === c ? "active" : ""}`} onClick={() => setActiveCat(c)}>{c}</button>
          ))}
        </section>

        <section className="metrics-grid">
          {filtered.map(m => (
            <MetricCard
              key={m.id}
              metric={m}
              running={running.has(m.id)}
              isCurrentInBatch={batch.current === m.id}
              onRun={() => runOne(m)}
              onDetails={() => m.last_result && setDetail({ metric: m, result: m.last_result })}
            />
          ))}
        </section>

        <div className="de-footer">DeepEval Test Runner · {metrics.length} metrics across {new Set(metrics.map(m => m.target)).size} targets</div>
      </div>

      {detail && <DetailModal metric={detail.metric} result={detail.result} onClose={() => setDetail(null)} />}
    </div>
  );
}

function MetricCard({ metric: m, running, isCurrentInBatch, onRun, onDetails }: { metric: Metric; running: boolean; isCurrentInBatch: boolean; onRun: () => void; onDetails: () => void; }) {
  const r = m.last_result;
  const status: "idle" | "running" | "pass" | "fail" | "error" = running ? "running" : r ? r.status : "idle";
  const catCls = m.category.toLowerCase().replace("-", "");
  const score = r?.score;
  const barWidth = score == null ? 0 : Math.max(2, score * 100);
  const barCls = status === "pass" ? "pass" : status === "fail" ? "fail" : status === "error" ? "error" : "pass";

  return (
    <article className={`metric-card ${running ? "is-running" : ""} ${isCurrentInBatch ? "is-current" : ""}`}>
      <div className="mc-tags">
        <span className={`mc-tag cat-${catCls}`}>{m.category}</span>
        <span className="mc-tag target">{m.target}</span>
        <span className="mc-threshold">{m.threshold_op} {m.threshold.toFixed(2)}</span>
      </div>
      <div className="mc-name">{m.name}</div>
      <div className="mc-desc">{m.description}</div>

      <div className="mc-result">
        <div className="row">
          <span className={`mc-status ${status}`}>
            {status === "running" && <span className="spinner small" />}
            {status === "running" ? "running" : status === "idle" ? "idle" : status}
          </span>
          <span className={`mc-score ${score == null ? "empty" : ""}`}>
            {score == null ? "—" : score.toFixed(3)}
          </span>
        </div>
        <div className="mc-bar"><div className={barCls} style={{ width: `${barWidth}%` }} /></div>
        {r ? (
          <>
            <div className="mc-reason">{r.reason || "(no reason returned)"}</div>
            <div className="mc-meta">
              {Math.round(r.metric_latency_ms + r.api_latency_ms)} ms<span className="sep">·</span>{r.judge_model}
            </div>
          </>
        ) : (
          <div className="mc-reason" style={{ color: "var(--ink-4)" }}>{running ? "Querying API + asking the judge…" : "Click Run to evaluate this metric live."}</div>
        )}
      </div>

      <div className="mc-actions">
        <button className="btn icon-play" onClick={onRun} disabled={running}>{running ? "Running…" : "Run"}</button>
        <button className="btn ghost" onClick={onDetails} disabled={!r}>Details</button>
      </div>
    </article>
  );
}

function DetailModal({ metric, result, onClose }: { metric: Metric; result: Result; onClose: () => void; }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h3>{metric.name}</h3>
        <div className="muted" style={{ marginBottom: 12 }}>
          <span style={{ background: "var(--cream-3)", color: "var(--ink)", padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
            {metric.category}
          </span>
          <span style={{ marginLeft: 8 }}>{metric.target} · {metric.threshold_op} {metric.threshold.toFixed(2)}</span>
        </div>

        <div className="qa input"><div className="ql">Input</div><div className="qb">{result.input}</div></div>
        <div className="qa actual"><div className="ql">Actual output</div><div className="qb">{result.actual_output}</div></div>
        {result.expected_output && <div className="qa expected"><div className="ql">Expected output</div><div className="qb">{result.expected_output}</div></div>}
        {result.retrieval_context && result.retrieval_context.length > 0 && (
          <div className="qa">
            <div className="ql">Retrieved context ({result.retrieval_context.length})</div>
            {result.retrieval_context.map((t, i) => (
              <pre key={i}>{(t || "").slice(0, 500)}{t && t.length > 500 ? "…" : ""}</pre>
            ))}
          </div>
        )}
        <div className="qa">
          <div className="ql">Result</div>
          <div className="qb">
            <b style={{ color: result.status === "pass" ? "var(--pass)" : result.status === "fail" ? "var(--fail)" : "var(--warn)" }}>{result.status.toUpperCase()}</b>
            {result.score != null && <> · score <code>{result.score.toFixed(3)}</code></>}
            {" · threshold "} <code>{result.threshold_op} {result.threshold.toFixed(2)}</code>
            {" · judge "} <code>{result.judge_model}</code>
            {" · "} <code>{Math.round(result.metric_latency_ms + result.api_latency_ms)} ms</code>
          </div>
        </div>
        <div className="qa"><div className="ql">Reason</div><div className="qb">{result.reason || "(no reason)"}</div></div>
        {result.traceback && (
          <div className="qa err"><div className="ql">Traceback</div><pre>{result.traceback}</pre></div>
        )}
      </div>
    </div>
  );
}
