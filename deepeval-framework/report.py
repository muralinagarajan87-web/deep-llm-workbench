"""Premium HTML dashboard generator for DeepEval results.

Reads reports/chatbot_results.json + reports/rag_results.json (whichever exist),
embeds the data into a single self-contained HTML file with charts, filters,
and a rich per-case drill-down.

Renders:
    reports/report.html       — the dashboard (this file is the entry point)
"""
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "reports"
TEMPLATE = ROOT / "dashboard_template.html"


def _summarize(suite_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    results = payload.get("results", [])
    metric_scores: Dict[str, List[float]] = {}
    metric_pass: Dict[str, List[bool]] = {}
    case_avgs, case_pass_rates, latencies = [], [], []

    for r in results:
        scores = [m.get("score") for m in r.get("metrics", []) if m.get("score") is not None]
        passes = [bool(m.get("success")) for m in r.get("metrics", []) if m.get("success") is not None]
        r["case_avg"] = mean(scores) if scores else 0.0
        r["case_pass_rate"] = (sum(1 for p in passes if p) / len(passes)) if passes else 0.0
        case_avgs.append(r["case_avg"])
        case_pass_rates.append(r["case_pass_rate"])
        latencies.append(r.get("latency_ms", 0))
        for m in r.get("metrics", []):
            metric_scores.setdefault(m["name"], []).append(m.get("score") or 0.0)
            metric_pass.setdefault(m["name"], []).append(bool(m.get("success")))

    per_metric = sorted(
        [
            {
                "name": k,
                "avg": mean(v) if v else 0.0,
                "pass_rate": (sum(1 for p in metric_pass[k] if p) / len(metric_pass[k])) if metric_pass[k] else 0.0,
                "n": len(v),
                "min": min(v) if v else 0.0,
                "max": max(v) if v else 0.0,
            }
            for k, v in metric_scores.items()
        ],
        key=lambda x: x["avg"],
        reverse=True,
    )

    # Heatmap matrix: rows = cases, cols = metric names
    metric_names = [m["name"] for m in per_metric]
    heatmap_rows = []
    for r in results:
        row = {"case_id": r["case_id"], "input": r["input"][:80], "scores": []}
        cell_lookup = {m["name"]: m for m in r.get("metrics", [])}
        for n in metric_names:
            cell = cell_lookup.get(n, {})
            row["scores"].append({
                "score": cell.get("score"),
                "success": cell.get("success"),
            })
        heatmap_rows.append(row)

    # Histogram of all scores in 10 bins
    all_scores = [s for arr in metric_scores.values() for s in arr]
    bins = [0] * 10
    for s in all_scores:
        idx = min(int(s * 10), 9)
        bins[idx] += 1

    return {
        "name": suite_name,
        "results": results,
        "per_metric": per_metric,
        "metric_names": metric_names,
        "heatmap_rows": heatmap_rows,
        "score_histogram": bins,
        "kpis": {
            "case_count": len(results),
            "metric_count": len(metric_names),
            "avg_score": mean(case_avgs) if case_avgs else 0.0,
            "pass_rate": mean(case_pass_rates) if case_pass_rates else 0.0,
            "avg_latency_ms": mean(latencies) if latencies else 0.0,
            "total_metric_evals": sum(len(v) for v in metric_scores.values()),
        },
    }


def render_html(config: Dict[str, Any]) -> Path:
    suites: List[Dict[str, Any]] = []
    for name, fname in [("Chatbot", "chatbot_results.json"), ("RAG", "rag_results.json")]:
        p = REPORTS / fname
        if p.exists():
            data = json.loads(p.read_text())
            suites.append(_summarize(name, data))
            if not config:
                config = data.get("config", {})

    overall = {
        "case_count": sum(s["kpis"]["case_count"] for s in suites),
        "metric_evals": sum(s["kpis"]["total_metric_evals"] for s in suites),
        "metric_count": sum(s["kpis"]["metric_count"] for s in suites),
        "avg_score": mean([s["kpis"]["avg_score"] for s in suites]) if suites else 0.0,
        "pass_rate": mean([s["kpis"]["pass_rate"] for s in suites]) if suites else 0.0,
        "avg_latency_ms": mean([s["kpis"]["avg_latency_ms"] for s in suites]) if suites else 0.0,
    }

    payload = {
        "config": config or {},
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "overall": overall,
        "suites": suites,
    }

    template = TEMPLATE.read_text()
    html = template.replace("__DEEPEVAL_DATA_PLACEHOLDER__", json.dumps(payload))
    out = REPORTS / "report.html"
    out.write_text(html)
    return out
