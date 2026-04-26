"""Top-level entry point: runs both suites and renders an HTML report.

Usage:
    python run_all.py                      # cloud judge (Groq gpt-oss-120b)
    DEEPEVAL_MODE=local python run_all.py  # local judge (Ollama gemma3:1b)
    DEEPEVAL_JUDGE_PROVIDER=openai python run_all.py
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

# allow `from configs...` and `from runner` regardless of cwd
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

from configs.llm_factory import describe_active_config
from configs.metrics import chatbot_metrics, rag_metrics
from runner import run_chatbot_suite, run_rag_suite, save_json, load_cases
from report import render_html


def main():
    cfg = describe_active_config()
    print("=" * 70)
    print(f"DeepEval — mode={cfg['mode']} | judge={cfg['judge_model']} | generator={cfg['generator_model']}")
    print("=" * 70)

    # --- Chatbot suite ---
    print("\n[1/2] Chatbot suite")
    cb_cases = load_cases("chatbot_cases.json")
    cb_metrics = chatbot_metrics()
    print(f"  cases:   {len(cb_cases)}")
    print(f"  metrics: {len(cb_metrics)}  →  {[m.__class__.__name__ for m in cb_metrics]}")
    cb_results = run_chatbot_suite(cb_cases, cb_metrics)
    p = save_json("chatbot", cb_results, cfg)
    print(f"  saved → {p}")

    # --- RAG suite ---
    print("\n[2/2] RAG suite")
    rag_cases = load_cases("rag_cases.json")
    r_metrics = rag_metrics()
    print(f"  cases:   {len(rag_cases)}")
    print(f"  metrics: {len(r_metrics)}  →  {[m.__class__.__name__ for m in r_metrics]}")
    rag_results = run_rag_suite(rag_cases, r_metrics)
    p = save_json("rag", rag_results, cfg)
    print(f"  saved → {p}")

    # --- Report ---
    out = render_html(cfg)
    print(f"\n✓ HTML report: {out}")
    print(f"   open with: open {out}")


if __name__ == "__main__":
    main()
