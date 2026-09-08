#!/usr/bin/env python3
"""Offline, text-only Notion NDJSON -> synthetic Anthropic Messages SSE proof.

The adapter is intentionally narrow. It supports the captured patch-start,
patch, record-map, patch-sync lifecycle and exactly one text-only
agent-inference step. It never reads HAR headers, cookies, IDs, record-map
contents, or network resources.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


class ConversionError(ValueError):
    """Raised when an input cannot be represented by the strict proof."""


_UNSUPPORTED_STATE_STEP_TYPES = frozenset({
    "activate-transcript-compaction",
    "agent-transcript-summary",
    "error",
    "premium-feature-unavailable",
    "summarize-transcript",
    "summarize-transcript-error",
    "summarize-transcript-record-map",
    "summary-inference",
})


@dataclass(frozen=True)
class ConversionResult:
    sse: str
    fidelity: dict[str, Any]
    text: str
    event_types: tuple[str, ...]


def parse_ndjson(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ConversionError(f"invalid JSON on NDJSON line {line_number}") from exc
        if not isinstance(value, dict) or not isinstance(value.get("type"), str):
            raise ConversionError(f"NDJSON line {line_number} is not a typed object")
        events.append(value)
    if not events:
        raise ConversionError("empty NDJSON input")
    return events


def _pointer_tokens(pointer: str) -> list[str]:
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ConversionError("patch path is not a JSON pointer")
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def _list_index(token: str, size: int, *, allow_end: bool = False) -> int:
    if not token.isdigit():
        raise ConversionError("non-numeric list index in patch path")
    index = int(token)
    limit = size if allow_end else size - 1
    if index < 0 or index > limit:
        raise ConversionError("list index outside reconstructed state")
    return index


def _parent_and_key(root: Any, tokens: list[str]) -> tuple[Any, str]:
    if not tokens:
        raise ConversionError("root replacement is outside proof scope")
    current = root
    for token in tokens[:-1]:
        if isinstance(current, list):
            current = current[_list_index(token, len(current))]
        elif isinstance(current, dict):
            if token not in current:
                raise ConversionError("patch path traverses a missing object key")
            current = current[token]
        else:
            raise ConversionError("patch path traverses a scalar")
    return current, tokens[-1]


def apply_notion_operation(root: Any, operation: dict[str, Any]) -> None:
    opcode = operation.get("o")
    tokens = _pointer_tokens(operation.get("p"))
    parent, key = _parent_and_key(root, tokens)

    if opcode == "a":
        # In the captured reducer format, an `a` operation whose `v` member is
        # absent clears the target. A present JSON null remains an assigned
        # value, so membership—not operation.get("v")—is significant here.
        if "v" not in operation:
            if isinstance(parent, list):
                if key == "-":
                    raise ConversionError("clear operation cannot target list append position")
                del parent[_list_index(key, len(parent))]
            elif isinstance(parent, dict):
                parent.pop(key, None)
            else:
                raise ConversionError("clear operation targets a scalar")
            return

        # Keep the reconstructed document independent from the parsed patch
        # event. Later `x` operations must not mutate their earlier source op.
        value = deepcopy(operation.get("v"))
        if isinstance(parent, list):
            if key == "-":
                parent.append(value)
            else:
                parent.insert(_list_index(key, len(parent), allow_end=True), value)
        elif isinstance(parent, dict):
            parent[key] = value
        else:
            raise ConversionError("add operation targets a scalar")
        return

    if opcode == "x":
        value = operation.get("v")
        if not isinstance(value, str):
            raise ConversionError("text-extension operation has a non-string value")
        if isinstance(parent, list):
            index = _list_index(key, len(parent))
            if not isinstance(parent[index], str):
                raise ConversionError("text-extension target is not a string")
            parent[index] += value
        elif isinstance(parent, dict):
            if not isinstance(parent.get(key), str):
                raise ConversionError("text-extension target is not a string")
            parent[key] += value
        else:
            raise ConversionError("text-extension operation targets a scalar")
        return

    raise ConversionError(f"unsupported Notion patch opcode: {opcode!r}")


def _single_text_content(step: dict[str, Any]) -> str:
    value = step.get("value")
    if not isinstance(value, list) or len(value) != 1:
        raise ConversionError("proof requires exactly one inference content block")
    block = value[0]
    if not isinstance(block, dict) or block.get("type") != "text":
        raise ConversionError("thinking, signatures, tools, and non-text blocks are unsupported")
    content = block.get("content")
    if not isinstance(content, str):
        raise ConversionError("inference text content is not a string")
    return content


def _reject_unsupported_state_steps(state: list[Any]) -> None:
    """Fail closed on known state semantics the text proof cannot preserve.

    These are transcript step types, not top-level NDJSON event types. Checking
    after every operation also catches a marker that is appended and later
    cleared before patch-sync.
    """
    unsupported = sorted({
        step_type
        for step in state
        if isinstance(step, dict)
        and isinstance((step_type := step.get("type")), str)
        and step_type in _UNSUPPORTED_STATE_STEP_TYPES
    })
    if unsupported:
        raise ConversionError(
            "unsupported Notion state step type(s): " + ", ".join(unsupported)
        )


def _validate_tracked_inference(state: list[Any], inference_index: int | None) -> None:
    if inference_index is None:
        return
    if (
        inference_index >= len(state)
        or not isinstance(state[inference_index], dict)
        or state[inference_index].get("type") != "agent-inference"
    ):
        raise ConversionError("tracked agent-inference was moved, removed, or replaced")
    if any(
        isinstance(step, dict) and step.get("type") == "agent-tool-result"
        for step in state[inference_index + 1:]
    ):
        raise ConversionError("post-inference tool results are outside the text-only proof")


def _nonnegative_integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ConversionError(f"terminal {field} is not a non-negative integer")
    return value


def _sse_frame(event_name: str, payload: dict[str, Any]) -> str:
    if payload.get("type") != event_name:
        raise AssertionError("SSE event name must equal data.type")
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {data}\n\n"


def _render_sse(model_alias: str, chunks: Iterable[str], metadata: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model_alias):
        raise ConversionError("terminal model alias is not safe for the proof label")

    input_tokens = _nonnegative_integer(metadata.get("inputTokens"), "inputTokens")
    output_tokens = _nonnegative_integer(metadata.get("outputTokens"), "outputTokens")
    cached_tokens_created = metadata.get("cachedTokensCreated")
    cached_tokens_read = metadata.get("cachedTokensRead")
    start_usage: dict[str, Any] = {
        "input_tokens": input_tokens,
        "output_tokens": 0,
        "cache_creation_input_tokens": (
            None if cached_tokens_created is None
            else _nonnegative_integer(cached_tokens_created, "cachedTokensCreated")
        ),
        "cache_read_input_tokens": (
            None if cached_tokens_read is None
            else _nonnegative_integer(cached_tokens_read, "cachedTokensRead")
        ),
    }
    terminal_usage = dict(start_usage)
    terminal_usage["output_tokens"] = output_tokens
    terminal_usage["output_tokens_details"] = None
    terminal_usage["server_tool_use"] = None
    start_usage.update({
        "cache_creation": None,
        "inference_geo": None,
        "output_tokens_details": None,
        "server_tool_use": None,
        "service_tier": None,
    })

    frames: list[str] = []
    event_types: list[str] = []

    def emit(name: str, payload: dict[str, Any]) -> None:
        event_types.append(name)
        frames.append(_sse_frame(name, payload))

    emit("message_start", {
        "type": "message_start",
        "message": {
            "id": "msg_notion_adapter_0001",
            "type": "message",
            "role": "assistant",
            "model": f"notion/{model_alias}",
            "content": [],
            "container": None,
            "stop_reason": None,
            "stop_details": None,
            "stop_sequence": None,
            "usage": start_usage,
        },
    })
    emit("content_block_start", {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "text", "text": "", "citations": None},
    })
    for chunk in chunks:
        if not isinstance(chunk, str):
            raise ConversionError("inference text chunk is not a string")
        if not chunk:
            continue
        emit("content_block_delta", {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": chunk},
        })
    emit("content_block_stop", {"type": "content_block_stop", "index": 0})
    emit("message_delta", {
        "type": "message_delta",
        "delta": {
            "container": None,
            "stop_reason": "end_turn",
            "stop_details": None,
            "stop_sequence": None,
        },
        "usage": terminal_usage,
    })
    emit("message_stop", {"type": "message_stop"})
    return "".join(frames), tuple(event_types)


def convert_events(events: list[dict[str, Any]]) -> ConversionResult:
    if events[0].get("type") != "patch-start":
        raise ConversionError("stream must begin with patch-start")
    if events[-1].get("type") != "patch-sync":
        raise ConversionError("stream must end with patch-sync")

    start_data = events[0].get("data")
    start_state = start_data.get("s") if isinstance(start_data, dict) else None
    if not isinstance(start_state, list):
        raise ConversionError("patch-start does not contain state array data.s")
    # Notion patch paths are rooted at `/s/...`, so retain the protocol's
    # document wrapper while reconstructing instead of applying them directly
    # to the state list.
    document = {"s": deepcopy(start_state)}
    _reject_unsupported_state_steps(document["s"])
    inference_index: int | None = None
    chunks: list[str] = []
    saw_record_map = False
    saw_sync = False
    terminal_state: list[Any] | None = None

    for position, event in enumerate(events[1:], start=2):
        event_type = event.get("type")
        if event_type == "patch":
            if saw_record_map or saw_sync:
                raise ConversionError("patch appears after terminal record phase")
            operations = event.get("v")
            if not isinstance(operations, list):
                raise ConversionError(f"patch event {position} has no operation list")
            for operation in operations:
                if not isinstance(operation, dict):
                    raise ConversionError("patch operation is not an object")
                path = operation.get("p")
                value = operation.get("v")
                apply_notion_operation(document, operation)
                state = document.get("s")
                if not isinstance(state, list):
                    raise ConversionError("patch operation replaced state array data.s")
                _reject_unsupported_state_steps(state)
                _validate_tracked_inference(state, inference_index)

                if path == "/s/-" and isinstance(value, dict) and value.get("type") == "agent-inference":
                    if inference_index is not None:
                        raise ConversionError("proof supports one appended agent-inference")
                    inference_index = len(state) - 1
                    chunks.append(_single_text_content(value))
                    continue

                if operation.get("o") == "x" and inference_index is not None:
                    expected = f"/s/{inference_index}/value/0/content"
                    if path == expected:
                        if not isinstance(value, str):
                            raise ConversionError("inference text extension is not a string")
                        chunks.append(value)

        elif event_type == "record-map":
            if saw_record_map or saw_sync:
                raise ConversionError("duplicate or misplaced record-map")
            saw_record_map = True
            # The proof deliberately does not inspect record-map contents.

        elif event_type == "patch-sync":
            if position != len(events):
                raise ConversionError("patch-sync is not the final event")
            if not saw_record_map:
                raise ConversionError("captured lifecycle requires record-map before patch-sync")
            sync_data = event.get("data")
            sync_state = sync_data.get("s") if isinstance(sync_data, dict) else None
            if not isinstance(sync_state, list):
                raise ConversionError("patch-sync does not contain state array data.s")
            terminal_state = deepcopy(sync_state)
            saw_sync = True

        elif event_type == "error":
            raise ConversionError("Notion error events are outside the text-only proof")

        else:
            raise ConversionError(f"unsupported top-level Notion event: {event_type!r}")

    if not saw_record_map or not saw_sync:
        raise ConversionError("incomplete captured lifecycle")
    if inference_index is None:
        raise ConversionError("no appended agent-inference was found")
    if terminal_state is None:
        raise ConversionError("patch-sync state is unavailable")

    state = terminal_state
    final_inferences = [
        step for step in state
        if isinstance(step, dict) and step.get("type") == "agent-inference"
    ]
    if len(final_inferences) != 1:
        raise ConversionError("final state must contain exactly one agent-inference")
    final_inference = final_inferences[0]
    final_text = _single_text_content(final_inference)
    if "".join(chunks) != final_text:
        raise ConversionError("incremental text does not equal patch-sync text")
    if document["s"] != terminal_state:
        raise ConversionError("reconstructed patch state does not equal patch-sync state")

    model_alias = final_inference.get("model")
    if not isinstance(model_alias, str) or not model_alias:
        raise ConversionError("terminal model alias is missing")
    sse, event_types = _render_sse(model_alias, chunks, final_inference)

    fidelity = {
        "anthropic_sdk_shape_version": "0.121.0",
        "anthropic_shaped_not_provider_authentic": True,
        "buffered_until_patch_sync": True,
        "explicit_nulls_for_unobserved_contract_fields": True,
        "terminal_only_input_usage": True,
        "input_usage_retimed_to_message_start": True,
        "terminal_usage_is_cumulative": True,
        "terminal_usage_reemitted_for_sdk_correction": True,
        "synthetic_stop_reason": True,
        "stop_reason_value": "end_turn",
        "model_identifier_is_notion_alias": True,
        "usage_is_notion_reported": True,
        "cache_usage_semantics_verified": False,
        "supports_thinking": False,
        "supports_signatures": False,
        "supports_tools": False,
        "supports_compaction": False,
        "supports_errors": False,
        "lossless_round_trip": False,
        "text_only": True,
    }
    return ConversionResult(sse=sse, fidelity=fidelity, text=final_text, event_types=event_types)


def convert_ndjson(text: str) -> ConversionResult:
    return convert_events(parse_ndjson(text))


def _json_document(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="privacy-safe Notion NDJSON fixture")
    parser.add_argument("--sse-out", type=Path, help="write SSE here instead of stdout")
    parser.add_argument("--fidelity-out", type=Path, help="write fidelity flags as JSON")
    args = parser.parse_args()

    try:
        result = convert_ndjson(args.input.read_text(encoding="utf-8"))
    except (OSError, ConversionError) as exc:
        print(f"conversion failed: {exc}", file=sys.stderr)
        return 2

    if args.sse_out:
        args.sse_out.write_text(result.sse, encoding="utf-8")
    else:
        sys.stdout.write(result.sse)
    if args.fidelity_out:
        args.fidelity_out.write_text(_json_document(result.fidelity), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
