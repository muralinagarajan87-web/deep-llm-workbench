"""Switchable judge / generator LLM factory.

Supports three providers behind a single DeepEvalBaseLLM-compatible interface:
  - groq    (cloud)  — default judge:    openai/gpt-oss-120b
  - openai  (cloud)  — alternate judge:  gpt-4o-mini
  - ollama  (local)  — judge + generator: gemma3:1b

Mode is selected via env:
  DEEPEVAL_MODE = "cloud" | "local"
  DEEPEVAL_JUDGE_PROVIDER = "groq" | "openai" | "ollama"   (overrides mode default)
"""
from __future__ import annotations
import os
import json
import re
import time
from typing import Any, Optional, Type

import httpx
from groq import Groq, RateLimitError as GroqRateLimitError
import openai
from pydantic import BaseModel
from deepeval.models.base_model import DeepEvalBaseLLM


def _sleep_for_rate_limit(err: Exception, default_sec: float = 5.0) -> float:
    """Extract a "try again in X" hint from a Groq error message."""
    m = re.search(r"try again in ([\d\.]+)s", str(err))
    if m:
        return min(float(m.group(1)) + 1.0, 30.0)
    return default_sec


def _strip_codefence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        # remove ```json or ```
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


class GroqJudge(DeepEvalBaseLLM):
    """Groq-hosted judge (default: gpt-oss-120b)."""

    def __init__(self, model: Optional[str] = None):
        self.model = model or os.getenv("GROQ_JUDGE_MODEL", "openai/gpt-oss-120b")
        self.client = Groq(api_key=os.environ["GROQ_API_KEY"])

    def load_model(self):
        return self.client

    def generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        kwargs = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": 2048,
        }
        if schema is not None:
            kwargs["response_format"] = {"type": "json_object"}
        # Retry on TPM rate limits — the message tells us how long to wait
        for attempt in range(4):
            try:
                resp = self.client.chat.completions.create(**kwargs)
                break
            except GroqRateLimitError as err:
                if attempt == 3:
                    raise
                wait = _sleep_for_rate_limit(err)
                time.sleep(wait)
        text = resp.choices[0].message.content or ""
        if schema is None:
            return text
        return schema.model_validate_json(_strip_codefence(text))

    async def a_generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        return self.generate(prompt, schema)

    def get_model_name(self) -> str:
        return f"groq/{self.model}"


class OpenAIJudge(DeepEvalBaseLLM):
    """OpenAI judge (default: gpt-4o-mini)."""

    def __init__(self, model: Optional[str] = None):
        self.model = model or os.getenv("OPENAI_JUDGE_MODEL", "gpt-4o-mini")
        self.client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    def load_model(self):
        return self.client

    def generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        if schema is not None:
            resp = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                response_format=schema,
                temperature=0,
            )
            return resp.choices[0].message.parsed
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return resp.choices[0].message.content or ""

    async def a_generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        return self.generate(prompt, schema)

    def get_model_name(self) -> str:
        return f"openai/{self.model}"


class OllamaLLM(DeepEvalBaseLLM):
    """Local Ollama judge / generator (default: gemma3:1b).

    Useful for fully-offline DeepEval runs and for SUT generation with
    a small open model.
    """

    def __init__(self, model: Optional[str] = None, base_url: Optional[str] = None):
        self.model = model or os.getenv("OLLAMA_GENERATION_MODEL", "gemma3:1b")
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")

    def load_model(self):
        return None

    def generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0, "num_predict": 1024},
        }
        if schema is not None:
            payload["format"] = "json"
        with httpx.Client(timeout=180.0) as c:
            r = c.post(f"{self.base_url}/api/generate", json=payload)
            r.raise_for_status()
            text = r.json().get("response", "")
        if schema is None:
            return text
        return schema.model_validate_json(_strip_codefence(text))

    async def a_generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None) -> Any:
        return self.generate(prompt, schema)

    def get_model_name(self) -> str:
        return f"ollama/{self.model}"


def get_judge() -> DeepEvalBaseLLM:
    """Return the active judge LLM based on env config."""
    mode = os.getenv("DEEPEVAL_MODE", "cloud").lower()
    provider = os.getenv(
        "DEEPEVAL_JUDGE_PROVIDER",
        "groq" if mode == "cloud" else "ollama",
    ).lower()
    if provider == "ollama" or mode == "local":
        return OllamaLLM()
    if provider == "openai":
        return OpenAIJudge()
    return GroqJudge()


def get_generator() -> DeepEvalBaseLLM:
    """Return a generator LLM (used when DeepEval needs to produce SUT outputs).

    Defaults to local Gemma 3 1B for cost-controlled local generation.
    """
    provider = os.getenv("DEEPEVAL_GEN_PROVIDER", "ollama").lower()
    if provider == "groq":
        return GroqJudge(model=os.getenv("GROQ_CHAT_MODEL", "llama-3.3-70b-versatile"))
    if provider == "openai":
        return OpenAIJudge(model=os.getenv("OPENAI_GEN_MODEL", "gpt-4o-mini"))
    return OllamaLLM()


def describe_active_config() -> dict:
    return {
        "mode": os.getenv("DEEPEVAL_MODE", "cloud"),
        "judge_provider": os.getenv("DEEPEVAL_JUDGE_PROVIDER", "groq"),
        "gen_provider": os.getenv("DEEPEVAL_GEN_PROVIDER", "ollama"),
        "judge_model": get_judge().get_model_name(),
        "generator_model": get_generator().get_model_name(),
    }
