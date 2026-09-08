#!/usr/bin/env python3
"""Validate the adapter against every sanitized HAR without emitting content."""

from __future__ import annotations

import json
from pathlib import Path
import sys


HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parents[1]
SCRIPTS = REFERENCE / "scripts"
for directory in (HERE, SCRIPTS):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import adapter  # noqa: E402
import extract_inference_protocol as protocol  # noqa: E402


def sse_payloads(rendered: str) -> list[dict]:
    """Parse data lines in memory; never print or persist their text fields."""
    payloads = []
    for line in rendered.splitlines():
        if line.startswith("data: "):
            value = json.loads(line[6:])
            if not isinstance(value, dict):
                raise AssertionError("SSE data payload is not an object")
            payloads.append(value)
    return payloads


def assert_usage(result: adapter.ConversionResult, source: dict) -> None:
    payloads = sse_payloads(result.sse)
    starts = [value for value in payloads if value.get("type") == "message_start"]
    deltas = [value for value in payloads if value.get("type") == "message_delta"]
    if len(starts) != 1 or len(deltas) != 1:
        raise AssertionError("expected one message_start and one message_delta")

    start_usage = starts[0]["message"]["usage"]
    terminal_usage = deltas[0]["usage"]
    expected = {
        "input_tokens": source["inputTokens"],
        "output_tokens": source["outputTokens"],
        "cache_creation_input_tokens": source.get("cachedTokensCreated"),
        "cache_read_input_tokens": source.get("cachedTokensRead"),
    }
    if start_usage["input_tokens"] != expected["input_tokens"]:
        raise AssertionError("message_start input usage differs from Notion metadata")
    if start_usage["output_tokens"] != 0:
        raise AssertionError("message_start output usage is not zero")
    for field in ("cache_creation_input_tokens", "cache_read_input_tokens"):
        if start_usage[field] != expected[field]:
            raise AssertionError(f"message_start {field} differs from Notion metadata")
    for field, expected_value in expected.items():
        if terminal_usage[field] != expected_value:
            raise AssertionError(f"message_delta {field} differs from Notion metadata")


def main() -> int:
    pairs = protocol.capture_pairs()
    inspected_hars = 0
    inference_entries = 0
    successes = 0
    errors_rejected = 0
    usage_matches = 0
    event_counts: list[int] = []

    for _, sanitized_path in pairs:
        inspected_hars += 1
        har = protocol.load_har(sanitized_path)
        entries = protocol.find_entries(har, "/api/v3/runInferenceTranscript")
        for entry_index, entry in enumerate(entries, start=1):
            inference_entries += 1
            summary = protocol.summarize_entry(entry, entry_index)
            source = protocol.decode_stream((entry.get("response") or {}).get("content") or {})
            if summary["outcome"] == "success":
                result = adapter.convert_ndjson(source)
                final_inference = summary["stream"]["final_inference"]
                if not isinstance(final_inference, dict):
                    raise AssertionError("successful summary has no terminal inference")
                assert_usage(result, final_inference)
                if not result.fidelity.get("anthropic_shaped_not_provider_authentic"):
                    raise AssertionError("projection lacks provider-authenticity warning")
                successes += 1
                usage_matches += 1
                event_counts.append(len(result.event_types))
            elif summary["outcome"] == "application_error":
                try:
                    adapter.convert_ndjson(source)
                except adapter.ConversionError:
                    errors_rejected += 1
                else:
                    raise AssertionError("application error was rendered as success SSE")
            else:
                raise AssertionError(f"unexpected inference outcome: {summary['outcome']}")

    observed = {
        "sanitized_hars": inspected_hars,
        "inference_entries": inference_entries,
        "successful_entries_converted": successes,
        "application_errors_rejected_before_sse": errors_rejected,
        "terminal_usage_matches": usage_matches,
        "sse_event_counts": event_counts,
    }
    expected = {
        "sanitized_hars": 6,
        "inference_entries": 7,
        "successful_entries_converted": 5,
        "application_errors_rejected_before_sse": 2,
        "terminal_usage_matches": 5,
        "sse_event_counts": [9, 9, 10, 9, 8],
    }
    if observed != expected:
        raise AssertionError(f"archive replay summary changed: {observed!r}")
    print(json.dumps({"result": "PASS", **observed}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
