"""Pytest entry — runs metrics against the live RAG Explorer."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase

from runner import call_rag, load_cases
from configs.metrics import rag_metrics


@pytest.fixture(scope="module")
def metrics():
    return rag_metrics()


@pytest.mark.parametrize("case", load_cases("rag_cases.json"), ids=lambda c: c["id"])
def test_rag_case(case, metrics):
    api = call_rag(case["input"])
    tc = LLMTestCase(
        input=case["input"],
        actual_output=api["answer"],
        expected_output=case.get("expected_output", ""),
        retrieval_context=api["retrieved"],
        context=api["retrieved"],
    )
    assert_test(tc, metrics)
