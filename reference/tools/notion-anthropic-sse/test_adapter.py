from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from adapter import (
    ConversionError,
    apply_notion_operation,
    convert_events,
    convert_ndjson,
    parse_ndjson,
)


ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
INPUT_FIXTURE = FIXTURES / "simple-text.ndjson"


def parse_sse_frames(stream: str) -> list[tuple[str, dict[str, object]]]:
    frames: list[tuple[str, dict[str, object]]] = []
    for raw_frame in stream.rstrip("\n").split("\n\n"):
        lines = raw_frame.splitlines()
        if len(lines) != 2 or not lines[0].startswith("event: ") or not lines[1].startswith("data: "):
            raise AssertionError(f"invalid SSE frame: {raw_frame!r}")
        frames.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return frames


def fixture_events() -> list[dict[str, object]]:
    return parse_ndjson(INPUT_FIXTURE.read_text(encoding="utf-8"))


def inference_append(events: list[dict[str, object]]) -> dict[str, object]:
    for event in events:
        for operation in event.get("v", []):
            value = operation.get("v")
            if operation.get("p") == "/s/-" and isinstance(value, dict):
                if value.get("type") == "agent-inference":
                    return value
    raise AssertionError("fixture has no inference append")


class AdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = INPUT_FIXTURE.read_text(encoding="utf-8")
        self.result = convert_ndjson(self.source)
        self.frames = parse_sse_frames(self.result.sse)

    def test_exact_sse_event_order(self) -> None:
        expected = (
            "message_start",
            "content_block_start",
            "content_block_delta",
            "content_block_delta",
            "content_block_delta",
            "content_block_stop",
            "message_delta",
            "message_stop",
        )
        self.assertEqual(self.result.event_types, expected)
        self.assertEqual(tuple(name for name, _ in self.frames), expected)

    def test_sse_event_name_equals_data_type(self) -> None:
        for event_name, payload in self.frames:
            with self.subTest(event_name=event_name):
                self.assertEqual(payload["type"], event_name)

    def test_reconstructs_exact_text(self) -> None:
        deltas = [
            payload["delta"]["text"]
            for event_name, payload in self.frames
            if event_name == "content_block_delta"
        ]
        self.assertEqual(deltas, ["The adapter", " works", " offline."])
        self.assertEqual("".join(deltas), "The adapter works offline.")
        self.assertEqual(self.result.text, "The adapter works offline.")

    def test_control_steps_are_not_projected_as_anthropic_tools(self) -> None:
        self.assertNotIn("fixture_lookup", self.result.sse)
        self.assertNotIn("agent-tool-result", self.result.sse)

    def test_rejects_post_inference_tool_result(self) -> None:
        events = copy.deepcopy(fixture_events())
        step = {
            "type": "agent-tool-result",
            "name": "post_inference_fixture",
            "value": {"status": "ok"},
        }
        events.insert(-2, {
            "type": "patch",
            "v": [{"o": "a", "p": "/s/-", "v": step}],
        })
        events[-1]["data"]["s"].append(step)
        with patch("adapter._render_sse") as render_sse:
            with self.assertRaisesRegex(
                ConversionError,
                "post-inference tool results are outside",
            ):
                convert_events(events)
            render_sse.assert_not_called()

    def test_input_and_cache_usage_are_in_message_start(self) -> None:
        start = self.frames[0][1]["message"]
        self.assertEqual(start["model"], "notion/fixture-model")
        self.assertEqual(start["usage"], {
            "input_tokens": 23,
            "output_tokens": 0,
            "cache_creation_input_tokens": 4,
            "cache_read_input_tokens": 11,
            "cache_creation": None,
            "inference_geo": None,
            "output_tokens_details": None,
            "server_tool_use": None,
            "service_tier": None,
        })

    def test_sdk_shape_emits_explicit_nulls_for_unobserved_fields(self) -> None:
        message = self.frames[0][1]["message"]
        self.assertIsNone(message["container"])
        self.assertIsNone(message["stop_details"])
        content_block = self.frames[1][1]["content_block"]
        self.assertIsNone(content_block["citations"])
        final_delta = next(payload for name, payload in self.frames if name == "message_delta")
        self.assertIsNone(final_delta["delta"]["container"])
        self.assertIsNone(final_delta["delta"]["stop_details"])
        for field in (
            "cache_creation",
            "inference_geo",
            "output_tokens_details",
            "server_tool_use",
            "service_tier",
        ):
            self.assertIsNone(message["usage"][field])

    def test_terminal_usage_repeats_cumulative_correction_fields(self) -> None:
        final_delta = next(payload for name, payload in self.frames if name == "message_delta")
        self.assertEqual(final_delta["usage"], {
            "input_tokens": 23,
            "output_tokens": 6,
            "cache_creation_input_tokens": 4,
            "cache_read_input_tokens": 11,
            "output_tokens_details": None,
            "server_tool_use": None,
        })
        start_usage = self.frames[0][1]["message"]["usage"]
        for field in (
            "input_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        ):
            self.assertEqual(final_delta["usage"][field], start_usage[field])
        self.assertEqual(start_usage["output_tokens"], 0)
        self.assertEqual(final_delta["usage"]["output_tokens"], 6)
        self.assertEqual(final_delta["delta"], {
            "container": None,
            "stop_reason": "end_turn",
            "stop_details": None,
            "stop_sequence": None,
        })

    def test_missing_cache_counters_use_required_nullable_sdk_fields(self) -> None:
        events = copy.deepcopy(fixture_events())
        cache_fields = {"cachedTokensCreated", "cachedTokensRead"}
        for event in events:
            if event.get("type") == "patch":
                event["v"] = [
                    operation for operation in event["v"]
                    if operation.get("p", "").rsplit("/", 1)[-1] not in cache_fields
                ]
        inference = events[-1]["data"]["s"][-1]
        for field in cache_fields:
            inference.pop(field)

        frames = parse_sse_frames(convert_events(events).sse)
        start_usage = frames[0][1]["message"]["usage"]
        final_usage = next(payload for name, payload in frames if name == "message_delta")["usage"]
        for usage in (start_usage, final_usage):
            self.assertIn("cache_creation_input_tokens", usage)
            self.assertIn("cache_read_input_tokens", usage)
            self.assertIsNone(usage["cache_creation_input_tokens"])
            self.assertIsNone(usage["cache_read_input_tokens"])

    def test_output_is_deterministic_and_matches_goldens(self) -> None:
        second = convert_ndjson(self.source)
        self.assertEqual(second, self.result)
        golden_sse = (FIXTURES / "simple-text.expected.sse").read_text(encoding="utf-8")
        # Text files conventionally retain one EOF newline; SSE requires the
        # terminal frame to end with a blank line (two newline characters).
        self.assertEqual(self.result.sse, golden_sse.rstrip("\n") + "\n\n")
        self.assertEqual(
            self.result.fidelity,
            json.loads((FIXTURES / "simple-text.expected-fidelity.json").read_text(encoding="utf-8")),
        )

    def test_event_conversion_is_repeatable_and_does_not_mutate_input(self) -> None:
        events = fixture_events()
        original = copy.deepcopy(events)
        first = convert_events(events)
        second = convert_events(events)
        self.assertEqual(events, original)
        self.assertEqual(first, second)

    def test_add_without_value_clears_but_null_remains_a_value(self) -> None:
        document = {"s": [{"cleared": True, "nullable": True}]}
        apply_notion_operation(document, {"o": "a", "p": "/s/0/cleared"})
        apply_notion_operation(document, {"o": "a", "p": "/s/0/nullable", "v": None})
        self.assertEqual(document, {"s": [{"nullable": None}]})

    def test_fidelity_flags_disclose_lossy_semantics(self) -> None:
        self.assertTrue(self.result.fidelity["buffered_until_patch_sync"])
        self.assertEqual(self.result.fidelity["anthropic_sdk_shape_version"], "0.121.0")
        self.assertTrue(self.result.fidelity["anthropic_shaped_not_provider_authentic"])
        self.assertTrue(self.result.fidelity["explicit_nulls_for_unobserved_contract_fields"])
        self.assertTrue(self.result.fidelity["terminal_only_input_usage"])
        self.assertTrue(self.result.fidelity["input_usage_retimed_to_message_start"])
        self.assertTrue(self.result.fidelity["terminal_usage_is_cumulative"])
        self.assertTrue(self.result.fidelity["terminal_usage_reemitted_for_sdk_correction"])
        self.assertTrue(self.result.fidelity["synthetic_stop_reason"])
        self.assertEqual(self.result.fidelity["stop_reason_value"], "end_turn")
        self.assertFalse(self.result.fidelity["cache_usage_semantics_verified"])
        for feature in ("thinking", "signatures", "tools", "compaction", "errors"):
            self.assertFalse(self.result.fidelity[f"supports_{feature}"])
        self.assertFalse(self.result.fidelity["lossless_round_trip"])

    def test_rejects_missing_patch_sync(self) -> None:
        with self.assertRaisesRegex(ConversionError, "stream must end with patch-sync"):
            convert_events(fixture_events()[:-1])

    def test_rejects_misordered_patch_sync(self) -> None:
        events = fixture_events()
        events.insert(-1, copy.deepcopy(events[-1]))
        with self.assertRaisesRegex(ConversionError, "patch-sync is not the final event"):
            convert_events(events)

    def test_rejects_misordered_record_map(self) -> None:
        events = fixture_events()
        record_map = events.pop(-2)
        events.insert(1, record_map)
        with self.assertRaisesRegex(ConversionError, "patch appears after terminal record phase"):
            convert_events(events)

    def test_rejects_non_text_inference_blocks(self) -> None:
        for block_type in ("thinking", "tool_use", "compaction", "image"):
            with self.subTest(block_type=block_type):
                events = copy.deepcopy(fixture_events())
                inference_append(events)["value"] = [{"type": block_type, "content": "synthetic"}]
                with self.assertRaisesRegex(ConversionError, "non-text blocks are unsupported"):
                    convert_events(events)

    def test_rejects_known_compaction_and_summary_state_steps(self) -> None:
        step_types = (
            "agent-transcript-summary",
            "activate-transcript-compaction",
            "summary-inference",
            "summarize-transcript",
            "summarize-transcript-record-map",
            "summarize-transcript-error",
        )
        for step_type in step_types:
            with self.subTest(step_type=step_type):
                events = copy.deepcopy(fixture_events())
                step = {"type": step_type, "value": {"synthetic": True}}
                events.insert(-2, {
                    "type": "patch",
                    "v": [{"o": "a", "p": "/s/-", "v": step}],
                })
                events[-1]["data"]["s"].append(step)
                with patch("adapter._render_sse") as render_sse:
                    with self.assertRaisesRegex(
                        ConversionError,
                        "unsupported Notion state step type",
                    ):
                        convert_events(events)
                    render_sse.assert_not_called()

    def test_rejects_known_failure_state_steps(self) -> None:
        for step_type in ("error", "premium-feature-unavailable"):
            with self.subTest(step_type=step_type):
                events = copy.deepcopy(fixture_events())
                step = {"type": step_type, "value": {"synthetic": True}}
                events.insert(-2, {
                    "type": "patch",
                    "v": [{"o": "a", "p": "/s/-", "v": step}],
                })
                events[-1]["data"]["s"].append(step)
                with patch("adapter._render_sse") as render_sse:
                    with self.assertRaisesRegex(
                        ConversionError,
                        "unsupported Notion state step type",
                    ):
                        convert_events(events)
                    render_sse.assert_not_called()

    def test_rejects_transient_compaction_marker(self) -> None:
        events = copy.deepcopy(fixture_events())
        marker = {
            "type": "agent-transcript-summary",
            "value": {"synthetic": True},
        }
        events[1:1] = [
            {"type": "patch", "v": [{"o": "a", "p": "/s/-", "v": marker}]},
            {"type": "patch", "v": [{"o": "a", "p": "/s/1"}]},
        ]
        with patch("adapter._render_sse") as render_sse:
            with self.assertRaisesRegex(
                ConversionError,
                "unsupported Notion state step type",
            ):
                convert_events(events)
            render_sse.assert_not_called()

    def test_rejects_in_stream_error_without_rendering_synthetic_success(self) -> None:
        events = copy.deepcopy(fixture_events())
        events.insert(-2, {
            "type": "error",
            "message": "synthetic fixture failure",
            "code": "synthetic_error",
        })
        with patch("adapter._render_sse") as render_sse:
            with self.assertRaisesRegex(
                ConversionError,
                "Notion error events are outside the text-only proof",
            ):
                convert_events(events)
            render_sse.assert_not_called()

    def test_rejects_multiple_inference_blocks(self) -> None:
        events = copy.deepcopy(fixture_events())
        inference_append(events)["value"] = [
            {"type": "text", "content": "first"},
            {"type": "text", "content": "second"},
        ]
        with self.assertRaisesRegex(ConversionError, "exactly one inference content block"):
            convert_events(events)

    def test_rejects_patch_sync_text_mismatch(self) -> None:
        events = copy.deepcopy(fixture_events())
        sync_state = events[-1]["data"]["s"]
        sync_state[-1]["value"][0]["content"] = "Different terminal text."
        with self.assertRaisesRegex(ConversionError, "incremental text does not equal patch-sync text"):
            convert_events(events)

    def test_rejects_non_text_state_mismatch_at_patch_sync(self) -> None:
        events = copy.deepcopy(fixture_events())
        sync_state = events[-1]["data"]["s"]
        sync_state[0]["value"]["mode"] = "different-terminal-state"
        with self.assertRaisesRegex(
            ConversionError,
            "reconstructed patch state does not equal patch-sync state",
        ):
            convert_events(events)


if __name__ == "__main__":
    unittest.main()
