#!/usr/bin/env python3
"""Local, non-network regression checks for HAR capture intake."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

import catalog_har_endpoints
import extract_inference_protocol
from har_capture_discovery import (
    CaptureDiscoveryError,
    discover_capture_pairs,
    discover_raw_hars,
    load_har,
    sanitized_path_for,
)


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
HAR_DIR = REFERENCE_ROOT / "har"
SANITIZER_PATH = HAR_DIR / "sanitize_har.py"


def load_sanitizer_module():
    spec = importlib.util.spec_from_file_location("notionize_sanitize_har", SANITIZER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load sanitizer: {SANITIZER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sanitize_har = load_sanitizer_module()


def inference_entry(
    request_body: dict | None = None,
    events: list[dict] | None = None,
    *,
    status: int = 200,
) -> dict:
    if request_body is None:
        request_body = {
            "asPatchResponse": True,
            "patchResponseVersion": 1,
            "transcript": [],
        }
    if events is None:
        events = [
            {"type": "patch-start", "version": 1, "data": {"s": []}},
            {"type": "patch-sync", "version": 1, "data": {"s": []}},
        ]
    stream = "\n".join(json.dumps(event, separators=(",", ":")) for event in events)
    return {
        "startedDateTime": "2026-08-26T00:00:00.000Z",
        "time": 1.0,
        "timings": {
            "blocked": 0,
            "dns": 0,
            "connect": 0,
            "send": 0,
            "wait": 1,
            "receive": 0,
            "ssl": 0,
        },
        "request": {
            "method": "POST",
            "url": "https://www.notion.so/api/v3/runInferenceTranscript",
            "httpVersion": "HTTP/2",
            "headers": [
                {"name": "Authorization", "value": "Bearer synthetic-regression-secret"},
                {"name": "Content-Type", "value": "application/json"},
            ],
            "cookies": [{"name": "session", "value": "synthetic"}],
            "queryString": [],
            "postData": {
                "mimeType": "application/json",
                "text": json.dumps(request_body, separators=(",", ":")),
                "params": [],
            },
            "headersSize": -1,
            "bodySize": -1,
        },
        "response": {
            "status": status,
            "statusText": "OK" if status == 200 else "Synthetic Error",
            "httpVersion": "HTTP/2",
            "headers": [{"name": "Set-Cookie", "value": "session=synthetic"}],
            "cookies": [{"name": "session", "value": "synthetic"}],
            "content": {
                "mimeType": "application/x-ndjson",
                "size": len(stream),
                "text": stream,
            },
            "redirectURL": "",
            "headersSize": -1,
            "bodySize": len(stream),
        },
        "cache": {},
    }


def inference_har(entries: list[dict] | None = None) -> dict:
    return {
        "log": {
            "version": "1.2",
            "creator": {"name": "capture-pipeline-regression", "version": "1"},
            "entries": entries if entries is not None else [inference_entry()],
        }
    }


def write_private_json(path: Path, document: dict) -> None:
    path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    path.chmod(0o600)


class SyntheticPipelineRegression(unittest.TestCase):
    def test_new_capture_discovery_sanitization_and_duplicate_detection(self) -> None:
        with tempfile.TemporaryDirectory(prefix="notionize-capture-regression-") as tmp:
            har_dir = Path(tmp)
            alpha = har_dir / "alpha.har"
            beta = har_dir / "beta.har"
            write_private_json(alpha, inference_har())

            self.assertEqual([path.name for path in discover_raw_hars(har_dir)], ["alpha.har"])
            self.assertEqual(
                [path.name for path in catalog_har_endpoints.raw_hars(har_dir)],
                ["alpha.har"],
            )
            with self.assertRaises(CaptureDiscoveryError):
                discover_capture_pairs(har_dir)
            self.assertEqual(
                sanitize_har.resolve_input_sources(
                    [], discover_dir=har_dir, missing_only=True
                ),
                [alpha],
            )

            sanitize_har.sanitize_file(
                alpha, sanitized_path_for(alpha), compact=True
            )
            write_private_json(beta, inference_har())
            sanitize_har.sanitize_file(beta, sanitized_path_for(beta), compact=True)

            # An orphan sanitized-looking file must never become a raw input.
            write_private_json(har_dir / "orphan.sanitized.har", inference_har())
            expected_raw = ["alpha.har", "beta.har"]
            self.assertEqual(
                [path.name for path in discover_raw_hars(har_dir)], expected_raw
            )
            self.assertEqual(
                [path.name for path in catalog_har_endpoints.raw_hars(har_dir)],
                expected_raw,
            )

            pairs = extract_inference_protocol.capture_pairs(har_dir)
            self.assertEqual(
                [(raw.name, clean.name) for raw, clean in pairs],
                [
                    ("alpha.har", "alpha.sanitized.har"),
                    ("beta.har", "beta.sanitized.har"),
                ],
            )
            result = extract_inference_protocol.build_result(pairs)
            self.assertEqual(result["schema_version"], 2)
            self.assertTrue(
                all(item["privacy_safe_summary_matches"] for item in result["validation"])
            )
            identity = result["transaction_identity"]
            self.assertEqual(identity["inference_bearing_capture_count"], 2)
            self.assertEqual(identity["inference_transaction_observation_count"], 2)
            self.assertEqual(identity["distinct_inference_transaction_count"], 1)
            self.assertEqual(
                [
                    (item["transaction"], item["duplicate_of"])
                    for item in identity["duplicate_transactions"]
                ],
                [("beta.har#entry-1", "alpha.har#entry-1")],
            )
            for _, sanitized in pairs:
                sanitize_har.validate_sanitized(load_har(sanitized))

    def test_multiple_inference_entries_include_quota_and_incomplete_states(self) -> None:
        secret_uuid = "11111111-1111-4111-8111-111111111111"
        private_prompt = "PRIVATE SYNTHETIC PROMPT PROSE"
        private_response = "PRIVATE SYNTHETIC RESPONSE PROSE"
        private_error_prose = "PRIVATE SYNTHETIC QUOTA PROSE"
        request_body = {
            "asPatchResponse": True,
            "patchResponseVersion": 2,
            "createdSource": "workflows",
            "threadType": "workflow",
            "transcript": [
                {
                    "id": secret_uuid,
                    "type": "context",
                    "value": {
                        "workspaceData": {
                            secret_uuid: {"kind": "private-context-value"}
                        }
                    },
                },
                {"id": secret_uuid, "type": "user", "value": [[private_prompt]]},
            ],
        }
        inference = {
            "id": secret_uuid,
            "type": "agent-inference",
            "model": "synthetic-model",
            "inputTokens": 11,
            "outputTokens": 7,
            "cachedTokensRead": 3,
            "cachedTokensCreated": 2,
            "maxContextTokens": 200000,
            "maxInputTokens": 160000,
            "value": [[private_response]],
        }
        successful_events = [
            {"type": "patch-start", "version": 2, "data": {"s": []}},
            {
                "type": "patch",
                "v": [{"o": "a", "p": "/s/-", "v": inference}],
            },
            {
                "type": "record-map",
                "recordMap": {"block": {secret_uuid: {"value": private_response}}},
            },
            {"type": "patch-sync", "version": 2, "data": {"s": [inference]}},
        ]
        unavailable = {
            "id": secret_uuid,
            "traceId": secret_uuid,
            "type": "premium-feature-unavailable",
            "message": private_error_prose,
            "featureAvailability": {
                "type": "usage-limit",
                "limit": {"type": "monthly", "current": 1, "total": 1},
            },
        }
        quota_events = [
            {"type": "patch-start", "version": 2, "data": {"s": [unavailable]}},
            {"type": "record-map", "recordMap": {}},
        ]
        incomplete_events = [
            {"type": "patch-start", "version": 2, "data": {"s": []}},
        ]

        with tempfile.TemporaryDirectory(prefix="notionize-multi-inference-") as tmp:
            har_dir = Path(tmp)
            raw = har_dir / "multi.har"
            clean = sanitized_path_for(raw)
            write_private_json(
                raw,
                inference_har([
                    inference_entry(request_body, successful_events),
                    inference_entry(request_body, quota_events),
                    inference_entry(request_body, incomplete_events),
                ]),
            )
            sanitize_har.sanitize_file(raw, clean, compact=True)

            raw_summary = extract_inference_protocol.summarize(raw)
            clean_summary = extract_inference_protocol.summarize(clean)
            self.assertEqual(raw_summary["inference_entry_count"], 3)
            self.assertEqual(raw_summary["inference_success_count"], 1)
            self.assertEqual(raw_summary["inference_application_error_count"], 1)
            self.assertEqual(
                raw_summary["inference_incomplete_or_unclassified_count"], 1
            )
            self.assertEqual(
                extract_inference_protocol.comparable_summary(raw_summary),
                extract_inference_protocol.comparable_summary(clean_summary),
            )

            success, quota, incomplete = raw_summary["inference_entries"]
            self.assertEqual(success["outcome"], "success")
            self.assertTrue(
                success["stream"]["patch_reconstruction"]["matches_patch_sync"]
            )
            self.assertTrue(success["stream"]["terminal_usage_present"])
            self.assertEqual(quota["outcome"], "application_error")
            self.assertEqual(
                quota["stream"]["application_error"]["step_types"],
                ["premium-feature-unavailable"],
            )
            self.assertFalse(quota["stream"]["terminal_patch_sync_present"])
            self.assertFalse(quota["stream"]["final_inference_present"])
            self.assertFalse(quota["stream"]["terminal_usage_present"])
            self.assertFalse(quota["stream"]["patch_reconstruction"]["attempted"])
            self.assertEqual(incomplete["outcome"], "incomplete_or_unclassified")
            self.assertIsNone(incomplete["stream"]["application_error"])

            serialized = json.dumps(raw_summary, ensure_ascii=False)
            for forbidden in (
                secret_uuid,
                private_prompt,
                private_response,
                private_error_prose,
                "synthetic-regression-secret",
                "https://",
            ):
                self.assertNotIn(forbidden, serialized)

            result = extract_inference_protocol.build_result([(raw, clean)])
            self.assertEqual(result["schema_version"], 2)
            identity = result["transaction_identity"]
            self.assertEqual(identity["inference_bearing_capture_count"], 1)
            self.assertEqual(identity["inference_transaction_observation_count"], 3)
            self.assertEqual(identity["distinct_inference_transaction_count"], 3)
            self.assertEqual(identity["successful_transaction_observation_count"], 1)
            self.assertEqual(
                identity["application_error_transaction_observation_count"], 1
            )
            self.assertEqual(
                identity["incomplete_or_unclassified_transaction_observation_count"],
                1,
            )

    def test_rejects_public_mode_symlinks_and_malformed_hars(self) -> None:
        with tempfile.TemporaryDirectory(prefix="notionize-capture-safety-") as tmp:
            har_dir = Path(tmp)
            public = har_dir / "public.har"
            write_private_json(public, inference_har())
            public.chmod(0o644)
            with self.assertRaises(CaptureDiscoveryError):
                discover_raw_hars(har_dir)
            public.unlink()

            malformed = har_dir / "malformed.har"
            write_private_json(malformed, {"not": "a HAR"})
            self.assertEqual(discover_raw_hars(har_dir), [malformed])
            with self.assertRaises(CaptureDiscoveryError):
                load_har(malformed)
            malformed.unlink()

            target = har_dir / "target.json"
            write_private_json(target, inference_har())
            linked = har_dir / "linked.har"
            os.symlink(target, linked)
            with self.assertRaises(CaptureDiscoveryError):
                discover_raw_hars(har_dir)

    def test_explicit_sanitized_input_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="notionize-capture-input-") as tmp:
            sanitized = Path(tmp) / "already.sanitized.har"
            write_private_json(sanitized, inference_har())
            with self.assertRaises(CaptureDiscoveryError):
                sanitize_har.resolve_input_sources([sanitized])

    def test_explicit_credentials_are_redacted_in_opaque_request_bodies(self) -> None:
        document = inference_har()
        entry = document["log"]["entries"][0]
        synthetic_jwt = (
            "eyJhbGciOiJIUzI1NiJ9."
            "eyJzdWIiOiJzeW50aGV0aWMtdGVzdCJ9."
            "c3ludGhldGljLXNpZ25hdHVyZS1vbmx5"
        )
        entry["request"]["postData"] = {
            "mimeType": "application/octet-stream",
            "text": f"opaque-prefix={synthetic_jwt}&opaque-suffix=1",
            "params": [],
        }

        sanitizer = sanitize_har.Sanitizer()
        sanitized = sanitizer.sanitize_har(document)
        text = sanitized["log"]["entries"][0]["request"]["postData"]["text"]

        self.assertNotIn(synthetic_jwt, text)
        self.assertIn("__REDACTED_JWT_", text)
        self.assertEqual(
            sanitizer.counts["bodies.request.opaque_token_documents"], 1
        )


def check_current_archive() -> None:
    """Read-only validation of the actual archive after synthetic tests pass."""
    raw_paths = discover_raw_hars(HAR_DIR)
    if raw_paths != catalog_har_endpoints.raw_hars(HAR_DIR):
        raise AssertionError("catalog discovery differs from shared discovery")
    pairs = extract_inference_protocol.capture_pairs(HAR_DIR)
    if [raw for raw, _ in pairs] != raw_paths:
        raise AssertionError("inference-pair discovery differs from raw discovery")
    for _, sanitized_path in pairs:
        sanitize_har.validate_sanitized(load_har(sanitized_path))
    if sanitize_har.resolve_input_sources(
        [], discover_dir=HAR_DIR, missing_only=True
    ):
        raise AssertionError("one or more raw HARs still need sanitization")
    result = extract_inference_protocol.build_result(pairs)
    if not all(item["privacy_safe_summary_matches"] for item in result["validation"]):
        raise AssertionError("raw/sanitized privacy-safe summaries differ")
    identity = result["transaction_identity"]
    duplicate_count = len(identity["duplicate_transactions"])
    print(
        "archive capture regression: PASS "
        f"({len(raw_paths)} raw, {len(pairs)} sanitized pairs, "
        f"{identity['inference_transaction_observation_count']} inference transactions, "
        f"{identity['application_error_transaction_observation_count']} application errors, "
        f"{duplicate_count} duplicate inference transaction(s))"
    )


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SyntheticPipelineRegression)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        return 1
    check_current_archive()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
