"""Shared runner — hits the live APIs, builds LLMTestCases, evaluates each metric.

Outputs:
  reports/<suite>_results.json    — machine-readable per-case-per-metric scores
  reports/<suite>_report.html     — human-readable rollup
"""
from __future__ import annotations
import json
import os
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import List, Dict, Any, Iterable

import requests
from dotenv import load_dotenv
from deepeval.test_case import LLMTestCase

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")

ECOMMERCE_URL = os.getenv("ECOMMERCE_API_URL", "http://localhost:4000")
RAG_URL = os.getenv("RAG_API_URL", "http://localhost:8000")

REPORTS = ROOT / "reports"
REPORTS.mkdir(exist_ok=True)


@dataclass
class CaseResult:
    case_id: str
    suite: str
    input: str
    actual_output: str
    expected_output: str = ""
    retrieval_context: List[str] = field(default_factory=list)
    metrics: List[Dict[str, Any]] = field(default_factory=list)
    latency_ms: float = 0.0
    error: str = ""


# ---------- API callers ---------- #

def call_chatbot(message: str) -> Dict[str, Any]:
    t0 = time.perf_counter()
    r = requests.post(f"{ECOMMERCE_URL}/api/chat", json={"message": message}, timeout=60)
    r.raise_for_status()
    d = r.json()
    return {"reply": d.get("reply", ""), "latency_ms": (time.perf_counter() - t0) * 1000}


def call_rag(message: str, k: int = 4) -> Dict[str, Any]:
    t0 = time.perf_counter()
    r = requests.post(f"{RAG_URL}/chat", json={"message": message, "k": k}, timeout=120)
    r.raise_for_status()
    d = r.json()
    return {
        "answer": d.get("answer", ""),
        "retrieved": [h.get("text", "") for h in d.get("retrieved_context", [])],
        "retrieved_meta": [h.get("metadata", {}) for h in d.get("retrieved_context", [])],
        "latency_ms": (time.perf_counter() - t0) * 1000,
    }


# ---------- Evaluation ---------- #

def evaluate_one(test_case: LLMTestCase, metrics: Iterable) -> List[Dict[str, Any]]:
    out = []
    for m in metrics:
        try:
            m.measure(test_case)
            out.append({
                "name": m.__class__.__name__ + (f":{m.name}" if hasattr(m, "name") and m.name and m.__class__.__name__ == "GEval" else ""),
                "score": float(m.score) if m.score is not None else None,
                "threshold": getattr(m, "threshold", None),
                "success": bool(m.is_successful()) if hasattr(m, "is_successful") else None,
                "reason": getattr(m, "reason", "") or "",
            })
        except Exception as e:
            out.append({
                "name": m.__class__.__name__,
                "score": None,
                "threshold": getattr(m, "threshold", None),
                "success": False,
                "reason": f"ERROR: {e}",
            })
    return out


def run_chatbot_suite(cases: List[Dict[str, Any]], metrics: List) -> List[CaseResult]:
    results: List[CaseResult] = []
    for c in cases:
        try:
            api = call_chatbot(c["input"])
            tc = LLMTestCase(
                input=c["input"],
                actual_output=api["reply"],
                expected_output=c.get("expected_output", ""),
                context=c.get("context", []),
            )
            metric_scores = evaluate_one(tc, metrics)
            results.append(CaseResult(
                case_id=c["id"], suite="chatbot",
                input=c["input"], actual_output=api["reply"],
                expected_output=c.get("expected_output", ""),
                metrics=metric_scores, latency_ms=api["latency_ms"],
            ))
        except Exception as e:
            results.append(CaseResult(
                case_id=c["id"], suite="chatbot",
                input=c["input"], actual_output="", error=str(e),
            ))
    return results


def run_rag_suite(cases: List[Dict[str, Any]], metrics: List) -> List[CaseResult]:
    results: List[CaseResult] = []
    for c in cases:
        try:
            api = call_rag(c["input"])
            tc = LLMTestCase(
                input=c["input"],
                actual_output=api["answer"],
                expected_output=c.get("expected_output", ""),
                retrieval_context=api["retrieved"],
                context=api["retrieved"],
            )
            metric_scores = evaluate_one(tc, metrics)
            results.append(CaseResult(
                case_id=c["id"], suite="rag",
                input=c["input"], actual_output=api["answer"],
                expected_output=c.get("expected_output", ""),
                retrieval_context=api["retrieved"],
                metrics=metric_scores, latency_ms=api["latency_ms"],
            ))
        except Exception as e:
            results.append(CaseResult(
                case_id=c["id"], suite="rag",
                input=c["input"], actual_output="", error=str(e),
            ))
    return results


def save_json(suite: str, results: List[CaseResult], config: Dict[str, Any]) -> Path:
    path = REPORTS / f"{suite}_results.json"
    path.write_text(json.dumps({"config": config, "results": [asdict(r) for r in results]}, indent=2, default=str))
    return path


def load_cases(name: str) -> List[Dict[str, Any]]:
    return json.loads((ROOT / "datasets" / name).read_text())
