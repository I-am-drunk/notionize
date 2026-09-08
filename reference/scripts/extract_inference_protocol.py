#!/usr/bin/env python3
"""Create and validate a privacy-safe summary of captured inference traces."""

from __future__ import annotations

import base64
from collections import Counter
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from har_capture_discovery import discover_capture_pairs, load_har


ROOT = Path("/Users/irene/Documents/Notionize/reference")
HAR_DIR = ROOT / "har"
OUT = ROOT / "analysis" / "inference-protocol.json"

INFERENCE_FIELDS = [
    "model", "inputTokens", "outputTokens", "cachedTokensRead",
    "cachedTokensCreated", "serverTimeToSubmitLlmMs",
    "serverTimeToFirstTokenMs", "serverPostSubmitTimeToFirstTokenMs",
    "maxContextTokens", "maxInputTokens",
]
TOKEN_USAGE_FIELDS = [
    "inputTokens", "outputTokens", "cachedTokensRead", "cachedTokensCreated",
]

# These are server-authored transcript step discriminators observed to denote
# an application-level failure.  Keep this allowlist narrow: absence of a
# patch-sync alone can also mean an interrupted or incomplete capture and must
# not be promoted to a known error.
APPLICATION_ERROR_STEP_TYPES = {
    "premium-feature-unavailable",
}

UUIDISH_RE = re.compile(
    r"(?i)(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?<![0-9a-f])[0-9a-f]{24,}(?![0-9a-f]))"
)
REDACTION_PLACEHOLDER_RE = re.compile(r"__REDACTED_[A-Z0-9_]+__")


def capture_pairs(har_dir: Path = HAR_DIR) -> list[tuple[Path, Path]]:
    """Discover all raw captures and require a validated sanitized partner."""
    return discover_capture_pairs(har_dir)


def schema_paths(value: Any, prefix: tuple[str, ...] = ()) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            rows.extend(schema_paths(item, prefix + (safe_schema_key(str(key)),)))
    elif isinstance(value, list):
        for item in value:
            rows.extend(schema_paths(item, prefix + ("[]",)))
    else:
        rows.append({"path": ".".join(prefix), "type": type_name(value)})
    return rows


def safe_schema_key(key: str) -> str:
    """Retain ordinary field names but collapse dynamic/sensitive map keys."""
    if key.isdigit() or key == "-":
        return "<index>"
    if (
        UUIDISH_RE.search(key)
        or REDACTION_PLACEHOLDER_RE.search(key)
        or "://" in key
        or "@" in key
        or len(key) > 96
    ):
        return "<dynamic-key>"
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.:-]*", key):
        return "<dynamic-key>"
    return key


def safe_enum(value: Any) -> Any:
    """Expose only compact protocol-like scalar values, never free-form text."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if not isinstance(value, str):
        return f"<{type_name(value)}>"
    if (
        len(value) <= 96
        and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:/-]*", value)
        and not UUIDISH_RE.search(value)
        and not REDACTION_PLACEHOLDER_RE.search(value)
        and "://" not in value
    ):
        return value
    return "<dynamic-value>"


def safe_json_pointer(pointer: Any) -> str:
    """Return a shape-preserving pointer without dynamic identifier tokens."""
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        return "<invalid-pointer>"
    return "/" + "/".join(safe_schema_key(token) for token in json_pointer_tokens(pointer))


def type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def decode_stream(content: dict[str, Any]) -> str:
    text = str(content.get("text") or "")
    if text.lstrip().startswith("{"):
        return text
    if str(content.get("encoding", "")).lower() == "base64":
        return base64.b64decode(text, validate=True).decode("utf-8")
    return text


def rich_text_character_count(value: Any, text_context: bool = True) -> int:
    """Count text-bearing rich-text leaves without returning their contents."""
    if isinstance(value, str):
        return len(value) if text_context else 0
    if isinstance(value, list):
        return sum(rich_text_character_count(item, text_context) for item in value)
    if isinstance(value, dict):
        text_keys = {"content", "text", "plain_text", "plainText"}
        return sum(
            rich_text_character_count(item, key in text_keys)
            for key, item in value.items()
        )
    return 0


def json_pointer_tokens(pointer: str) -> list[str]:
    if not pointer.startswith("/"):
        raise ValueError(f"unsupported JSON pointer: {pointer!r}")
    return [token.replace("~1", "/").replace("~0", "~") for token in pointer[1:].split("/")]


def patch_parent(document: Any, tokens: list[str]) -> tuple[Any, str]:
    if not tokens:
        raise ValueError("root patch operations are not supported by this capture extractor")
    parent = document
    for token in tokens[:-1]:
        parent = parent[int(token)] if isinstance(parent, list) else parent[token]
    return parent, tokens[-1]


def apply_stream_operation(document: Any, operation: dict[str, Any]) -> None:
    """Apply the compact `a` (assign/add) and `x` (string extend) operations."""
    parent, token = patch_parent(document, json_pointer_tokens(str(operation.get("p") or "")))
    opcode = operation.get("o")
    if opcode == "a":
        # A captured `a` without `v` clears an undefined field. Treating it as
        # a null assignment leaves a property absent from the terminal sync.
        if "v" not in operation:
            if isinstance(parent, list):
                if token != "-" and int(token) < len(parent):
                    parent.pop(int(token))
            else:
                parent.pop(token, None)
            return
        value = copy.deepcopy(operation["v"])
        if isinstance(parent, list):
            if token == "-":
                parent.append(value)
            else:
                parent.insert(int(token), value)
        else:
            parent[token] = value
        return
    if opcode == "x":
        if "v" not in operation or not isinstance(operation["v"], str):
            raise ValueError("captured string-extend operation has no string value")
        if isinstance(parent, list):
            index = int(token)
            if not isinstance(parent[index], str):
                raise ValueError("captured string-extend target is not a string")
            parent[index] += operation["v"]
        else:
            if not isinstance(parent.get(token), str):
                raise ValueError("captured string-extend target is not a string")
            parent[token] += operation["v"]
        return
    raise ValueError(f"unsupported compact patch opcode: {opcode!r}")


def reconstruct_patch_stream(events: list[dict[str, Any]]) -> dict[str, Any]:
    starts = [event for event in events if event.get("type") == "patch-start"]
    syncs = [event for event in events if event.get("type") == "patch-sync"]
    if len(starts) != 1 or len(syncs) != 1:
        raise ValueError(
            f"expected one patch-start and one patch-sync; found {len(starts)} and {len(syncs)}"
        )
    reconstructed = copy.deepcopy(starts[0].get("data") or {})
    operation_count = 0
    for event in events:
        if event.get("type") != "patch":
            continue
        for operation in event.get("v") or []:
            apply_stream_operation(reconstructed, operation)
            operation_count += 1
    matches = reconstructed == (syncs[0].get("data") or {})
    return {
        "operation_count": operation_count,
        "patch_start_version": starts[0].get("version"),
        "patch_sync_version": syncs[0].get("version"),
        "matches_patch_sync": matches,
    }


def find_entries(har: dict[str, Any], suffix: str) -> list[dict[str, Any]]:
    return [
        entry for entry in har.get("log", {}).get("entries", [])
        if suffix in str(entry.get("request", {}).get("url", ""))
    ]


def safe_request(request_body: dict[str, Any]) -> dict[str, Any]:
    transcript = request_body.get("transcript") or []
    steps = []
    for step in transcript:
        if not isinstance(step, dict):
            steps.append({"type": f"<{type_name(step)}>"})
            continue
        value = step.get("value")
        item: dict[str, Any] = {"type": safe_enum(step.get("type"))}
        if step.get("type") == "config" and isinstance(value, dict):
            connectors = value.get("availableConnectors", [])
            if not isinstance(connectors, list):
                connectors = []
            search_scopes = value.get("searchScopes", [])
            if not isinstance(search_scopes, list):
                search_scopes = []
            item["config"] = {
                "type": safe_enum(value.get("type")),
                "model": safe_enum(value.get("model", "auto")),
                "useWebSearch": value.get("useWebSearch"),
                "searchScopes": [
                    safe_enum(scope.get("type"))
                    for scope in search_scopes
                    if isinstance(scope, dict)
                ],
                "availableConnectors": [safe_enum(connector) for connector in connectors],
            }
        elif step.get("type") == "updated-config" and isinstance(value, dict):
            item["updated_config"] = {
                "model": safe_enum(value.get("model")),
                "modelFromUser": value.get("modelFromUser"),
                "reasoningEffort": safe_enum(value.get("reasoningEffort")),
            }
        elif step.get("type") == "user" and isinstance(value, list):
            text = "".join(
                part for row in value if isinstance(row, list)
                for part in row if isinstance(part, str)
            )
            item["message_characters"] = len(text)
        elif step.get("type") == "context":
            item["context_fields"] = (
                sorted({safe_schema_key(str(key)) for key in value})
                if isinstance(value, dict)
                else []
            )
        steps.append(item)
    return {
        "asPatchResponse": request_body.get("asPatchResponse"),
        "patchResponseVersion": request_body.get("patchResponseVersion"),
        "createThread": request_body.get("createThread", False),
        "generateTitle": request_body.get("generateTitle", False),
        "isPartialTranscript": request_body.get("isPartialTranscript", False),
        "saveAllThreadOperations": request_body.get("saveAllThreadOperations"),
        "setUnreadState": request_body.get("setUnreadState"),
        "createdSource": safe_enum(request_body.get("createdSource")),
        "threadType": safe_enum(request_body.get("threadType")),
        "transcript_steps": steps,
    }


def record_counts(record_map: Any) -> dict[str, int]:
    if not isinstance(record_map, dict):
        return {}
    result = {}
    for table, value in record_map.items():
        result[safe_schema_key(str(table))] = len(value) if isinstance(value, dict) else 0
    return dict(sorted(result.items()))


def parse_request_body(entry: dict[str, Any], entry_index: int) -> dict[str, Any]:
    request = entry.get("request") or {}
    text = str((request.get("postData") or {}).get("text") or "{}")
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError(f"inference entry {entry_index} has invalid request JSON") from None
    if not isinstance(value, dict):
        raise ValueError(f"inference entry {entry_index} request JSON is not an object")
    return value


def parse_stream_events(entry: dict[str, Any], entry_index: int) -> list[dict[str, Any]]:
    response = entry.get("response") or {}
    try:
        stream = decode_stream(response.get("content") or {})
    except (ValueError, UnicodeError):
        raise ValueError(f"inference entry {entry_index} response cannot be decoded") from None
    events: list[dict[str, Any]] = []
    for line_number, line in enumerate(stream.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, UnicodeError):
            raise ValueError(
                f"inference entry {entry_index} has invalid NDJSON at line {line_number}"
            ) from None
        if not isinstance(event, dict):
            raise ValueError(
                f"inference entry {entry_index} NDJSON line {line_number} is not an object"
            )
        events.append(event)
    return events


def event_state_steps(event: dict[str, Any]) -> list[dict[str, Any]]:
    data = event.get("data")
    state = data.get("s") if isinstance(data, dict) else None
    if not isinstance(state, list):
        return []
    return [step for step in state if isinstance(step, dict)]


def safe_inference_metadata(inference: dict[str, Any]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for key in INFERENCE_FIELDS:
        value = inference.get(key)
        if key == "model":
            metadata[key] = safe_enum(value)
        else:
            metadata[key] = value if value is None or isinstance(value, (int, float)) else None
    metadata["response_characters"] = rich_text_character_count(inference.get("value"))
    previous = inference.get("previousAttemptValues")
    failover = previous.get("modelFailover") if isinstance(previous, dict) else None
    metadata["modelFailover"] = safe_enum(failover)
    return metadata


def unavailable_steps(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return only allowlisted application-error steps, never their prose."""
    candidates: list[dict[str, Any]] = []
    for event in events:
        if event.get("type") in {"patch-start", "patch-sync"}:
            candidates.extend(event_state_steps(event))
        if event.get("type") == "patch":
            for operation in event.get("v") or []:
                if isinstance(operation, dict) and isinstance(operation.get("v"), dict):
                    candidates.append(operation["v"])
    return [
        step for step in candidates
        if step.get("type") in APPLICATION_ERROR_STEP_TYPES
    ]


def summarize_entry(entry: dict[str, Any], entry_index: int) -> dict[str, Any]:
    request = entry.get("request") or {}
    response = entry.get("response") or {}
    request_body = parse_request_body(entry, entry_index)
    events = parse_stream_events(entry, entry_index)
    starts = [event for event in events if event.get("type") == "patch-start"]
    syncs = [event for event in events if event.get("type") == "patch-sync"]
    error_steps = unavailable_steps(events)
    error_step_types = sorted({str(step.get("type")) for step in error_steps})
    response_status = response.get("status")
    http_error = isinstance(response_status, int) and not 200 <= response_status < 300

    if error_steps:
        outcome = "application_error"
    elif http_error:
        outcome = "http_error"
    elif len(starts) == 1 and len(syncs) == 1:
        outcome = "success"
    else:
        outcome = "incomplete_or_unclassified"

    if len(starts) == 1 and len(syncs) == 1:
        try:
            patch_reconstruction = reconstruct_patch_stream(events)
        except (KeyError, IndexError, TypeError, ValueError):
            raise ValueError(
                f"inference entry {entry_index} patch replay failed"
            ) from None
        if not patch_reconstruction["matches_patch_sync"]:
            raise ValueError(
                f"inference entry {entry_index} patch replay does not match patch-sync"
            )
        patch_reconstruction["attempted"] = True
    else:
        reason = (
            "application_error_without_patch_sync"
            if error_steps and not syncs
            else "terminal_patch_pair_unavailable"
        )
        patch_reconstruction = {
            "attempted": False,
            "reason": reason,
            "patch_start_count": len(starts),
            "patch_sync_count": len(syncs),
        }

    line_types = [safe_enum(event.get("type")) for event in events]
    patch_ops: Counter[str] = Counter()
    patch_paths: Counter[str] = Counter()
    appended_step_types: list[str] = []
    tools: list[dict[str, Any]] = []
    final_state: list[Any] = []
    initial_state: list[Any] = []
    maps: dict[str, int] = {}
    for event in events:
        if event.get("type") == "patch":
            for operation in event.get("v") or []:
                if not isinstance(operation, dict):
                    continue
                patch_ops[str(safe_enum(operation.get("o")))] += 1
                patch_paths[safe_json_pointer(operation.get("p"))] += 1
                value = operation.get("v")
                if isinstance(value, dict) and value.get("type"):
                    appended_step_types.append(str(safe_enum(value.get("type"))))
                    if value.get("type") == "agent-tool-result":
                        module_info = value.get("moduleInfo")
                        tool_input = value.get("input")
                        tools.append({
                            "toolName": safe_enum(value.get("toolName")),
                            "toolType": safe_enum(value.get("toolType")),
                            "state": safe_enum(value.get("state")),
                            "autoLoadPhase": safe_enum(value.get("autoLoadPhase")),
                            "durationMs": (
                                value.get("durationMs")
                                if isinstance(value.get("durationMs"), (int, float))
                                else None
                            ),
                            "module": safe_enum(
                                module_info.get("name")
                                if isinstance(module_info, dict)
                                else None
                            ),
                            "function": safe_enum(
                                tool_input.get("function")
                                if isinstance(tool_input, dict)
                                else None
                            ),
                        })
        elif event.get("type") == "patch-start":
            initial_state = [
                step for step in event_state_steps(event)
            ]
        elif event.get("type") == "record-map":
            maps = record_counts(event.get("recordMap"))
        elif event.get("type") == "patch-sync":
            final_state = [
                step for step in event_state_steps(event)
            ]

    inference = next(
        (
            step for step in final_state
            if isinstance(step, dict) and step.get("type") == "agent-inference"
        ),
        None,
    )
    inference_metadata = safe_inference_metadata(inference) if inference else None
    terminal_usage_present = bool(
        inference
        and any(
            isinstance(inference.get(key), (int, float))
            and not isinstance(inference.get(key), bool)
            for key in TOKEN_USAGE_FIELDS
        )
    )
    schema = {(row["path"], row["type"]) for row in schema_paths(request_body)}
    return {
        "entry_index": entry_index,
        "outcome": outcome,
        "duplicate_of": None,
        "transport": {
            "method": safe_enum(request.get("method")),
            "path": "/api/v3/runInferenceTranscript",
            "request_mime": safe_enum((request.get("postData") or {}).get("mimeType")),
            "status": response_status if isinstance(response_status, int) else None,
            "response_mime": safe_enum((response.get("content") or {}).get("mimeType")),
            "har_time_ms": entry.get("time") if isinstance(entry.get("time"), (int, float)) else None,
        },
        "request": safe_request(request_body),
        "request_leaf_schema": [
            {"path": path, "type": kind} for path, kind in sorted(schema)
        ],
        "stream": {
            "line_count": len(events),
            "line_types_in_order": line_types,
            "line_type_counts": dict(Counter(line_types)),
            "patch_op_counts": dict(sorted(patch_ops.items())),
            "patch_paths": dict(sorted(patch_paths.items())),
            "patch_reconstruction": patch_reconstruction,
            "appended_step_types": appended_step_types,
            "tool_results": tools,
            "record_map_table_counts": maps,
            "initial_step_types": [
                safe_enum(step.get("type")) for step in initial_state if isinstance(step, dict)
            ],
            "final_step_types": [
                safe_enum(step.get("type")) for step in final_state if isinstance(step, dict)
            ],
            "terminal_patch_sync_present": len(syncs) == 1,
            "final_inference_present": inference is not None,
            "terminal_usage_present": terminal_usage_present,
            "final_inference": inference_metadata,
            "application_error": (
                {
                    "step_types": error_step_types,
                    "feature_availability_metadata_present": any(
                        isinstance(step.get("featureAvailability"), dict)
                        for step in error_steps
                    ),
                }
                if error_steps
                else None
            ),
        },
    }


def summarize(source: Path) -> dict[str, Any]:
    har = load_har(source)
    entries = find_entries(har, "/api/v3/runInferenceTranscript")
    inference_entries = [
        summarize_entry(entry, entry_index)
        for entry_index, entry in enumerate(entries, start=1)
    ]
    outcomes = Counter(item["outcome"] for item in inference_entries)
    return {
        "capture": source.name,
        "inference_present": bool(inference_entries),
        "inference_entry_count": len(inference_entries),
        "inference_success_count": outcomes["success"],
        "inference_application_error_count": outcomes["application_error"],
        "inference_http_error_count": outcomes["http_error"],
        "inference_incomplete_or_unclassified_count": outcomes[
            "incomplete_or_unclassified"
        ],
        "inference_entries": inference_entries,
    }


def comparable_summary(summary: dict[str, Any]) -> dict[str, Any]:
    """Remove only the filename so raw and sanitized safe summaries can compare."""
    return {key: value for key, value in summary.items() if key != "capture"}


def transaction_sha256_pairs(source: Path) -> list[tuple[str, str]]:
    """Hash each request/decoded-response byte pair; never return either body."""
    har = load_har(source)
    entries = find_entries(har, "/api/v3/runInferenceTranscript")
    result: list[tuple[str, str]] = []
    for entry in entries:
        request_text = str(
            ((entry.get("request") or {}).get("postData") or {}).get("text") or ""
        )
        response_text = decode_stream((entry.get("response") or {}).get("content") or {})
        result.append((
            hashlib.sha256(request_text.encode("utf-8")).hexdigest(),
            hashlib.sha256(response_text.encode("utf-8")).hexdigest(),
        ))
    return result


def transaction_reference(capture_name: str, entry_index: int) -> str:
    return f"{capture_name}#entry-{entry_index}"


def build_result(capture_pair_list: list[tuple[Path, Path]]) -> dict[str, Any]:
    """Validate all pairs, summarize them, and retain transaction deduping."""
    captures = []
    validation = []
    first_capture_by_transaction: dict[tuple[str, str], str] = {}
    duplicate_transactions = []
    for raw_source, sanitized_source in capture_pair_list:
        raw_summary = summarize(raw_source)
        sanitized_summary = summarize(sanitized_source)
        summaries_match = comparable_summary(raw_summary) == comparable_summary(sanitized_summary)
        validation.append({
            "raw_capture": raw_source.name,
            "sanitized_capture": sanitized_source.name,
            "raw_inference_entry_count": raw_summary["inference_entry_count"],
            "sanitized_inference_entry_count": sanitized_summary["inference_entry_count"],
            "privacy_safe_summary_matches": summaries_match,
        })
        if not summaries_match:
            raise ValueError(
                f"privacy-safe summary differs between {raw_source.name} "
                f"and {sanitized_source.name}"
            )
        signatures = transaction_sha256_pairs(raw_source)
        if len(signatures) != len(raw_summary["inference_entries"]):
            raise AssertionError("transaction fingerprints do not align with summaries")
        for signature, transaction in zip(
            signatures, raw_summary["inference_entries"]
        ):
            reference = transaction_reference(raw_source.name, transaction["entry_index"])
            if signature in first_capture_by_transaction:
                duplicate_of = first_capture_by_transaction[signature]
                transaction["duplicate_of"] = duplicate_of
                duplicate_transactions.append({
                    "transaction": reference,
                    "capture": raw_source.name,
                    "entry_index": transaction["entry_index"],
                    "duplicate_of": duplicate_of,
                    "comparison_method": "SHA-256 equality over request postData text and decoded response NDJSON",
                    "request_sha256_equal": True,
                    "decoded_response_sha256_equal": True,
                })
            else:
                first_capture_by_transaction[signature] = reference
        captures.append(raw_summary)

    transaction_observations = [
        transaction
        for capture in captures
        for transaction in capture["inference_entries"]
    ]
    outcome_counts = Counter(item["outcome"] for item in transaction_observations)

    return {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "privacy_boundary": (
            "IDs, prompts, personal context values, response prose, URLs, headers, "
            "cookies, raw bodies, and record-map contents are omitted."
        ),
        "coverage": {
            "raw_har_count": len(capture_pair_list),
            "sanitized_har_count": len(capture_pair_list),
            "raw_files": [raw.name for raw, _ in capture_pair_list],
            "sanitized_files": [sanitized.name for _, sanitized in capture_pair_list],
        },
        "validation": validation,
        "transaction_identity": {
            "inference_bearing_capture_count": sum(
                1 for capture in captures if capture["inference_present"]
            ),
            "inference_transaction_observation_count": len(transaction_observations),
            "distinct_inference_transaction_count": len(first_capture_by_transaction),
            "successful_transaction_observation_count": outcome_counts["success"],
            "application_error_transaction_observation_count": outcome_counts[
                "application_error"
            ],
            "http_error_transaction_observation_count": outcome_counts["http_error"],
            "incomplete_or_unclassified_transaction_observation_count": outcome_counts[
                "incomplete_or_unclassified"
            ],
            "duplicate_transactions": duplicate_transactions,
        },
        "captures": captures,
    }


def main() -> None:
    result = build_result(capture_pairs())
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
