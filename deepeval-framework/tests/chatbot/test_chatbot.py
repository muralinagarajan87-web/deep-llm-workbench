"""Pytest entry — runs metrics against the live e-commerce chatbot."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase

from runner import call_chatbot, load_cases
from configs.metrics import chatbot_metrics


@pytest.fixture(scope="module")
def metrics():
    return chatbot_metrics()


@pytest.mark.parametrize("case", load_cases("chatbot_cases.json"), ids=lambda c: c["id"])
def test_chatbot_case(case, metrics):
    api = call_chatbot(case["input"])
    tc = LLMTestCase(
        input=case["input"],
        actual_output=api["reply"],
        expected_output=case.get("expected_output", ""),
        context=case.get("context", []),
    )
    assert_test(tc, metrics)
