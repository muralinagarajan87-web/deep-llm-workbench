# DeepEval Framework

Evaluates the e-commerce chatbot and RAG Explorer running locally, with **switchable judge LLMs** (cloud or local) and **17 metrics** total.

## Setup
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Make sure these are running:
- E-commerce chatbot backend: `http://localhost:4000`
- RAG Explorer backend: `http://localhost:8000`

## Run

### Cloud judge (default, recommended)
```bash
python run_all.py
```
Uses Groq `gpt-oss-120b` as judge.

### Local judge (fully offline)
```bash
DEEPEVAL_MODE=local python run_all.py
```
Uses Ollama `gemma3:1b` as judge. Slower and less reliable on rubric tasks but proves offline capability.

### Switch to OpenAI judge
```bash
DEEPEVAL_JUDGE_PROVIDER=openai python run_all.py
```

### Pytest mode (per-case assertions)
```bash
.venv/bin/pytest tests/ -v
```

## Metrics

**Chatbot suite (11):**
AnswerRelevancy, Hallucination, Toxicity, Bias, PromptAlignment, GEval-Correctness, GEval-Helpfulness, GEval-Conciseness, GEval-Tone, GEval-RefusalAppropriateness, GEval-Coherence

**RAG suite (17):** all of the above **plus** Faithfulness, ContextualPrecision, ContextualRecall, ContextualRelevancy, Summarization, GEval-CitationCompliance.

## Outputs
- `reports/chatbot_results.json`
- `reports/rag_results.json`
- `reports/report.html` ← open this for the rollup
