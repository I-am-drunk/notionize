#!/usr/bin/env python3
"""Build privacy-safe endpoint catalogs from the raw Notion HAR captures.

Only URL structure, methods, status/MIME/timing metadata, and query-parameter
names are retained. Headers, cookies, query values, and request/response bodies
are never copied into the outputs.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from har_capture_discovery import discover_raw_hars, load_har


ROOT = Path("/Users/irene/Documents/Notionize/reference")
HAR_DIR = ROOT / "har"
OUT_DIR = ROOT / "analysis"

DIRECT_AI = {
    "/api/v3/runInferenceTranscript": "core_inference_stream",
    "/api/v3/getAvailableModels": "model_roster",
    "/api/v3/getAIUsageEligibilityV2": "usage_eligibility",
    "/api/v3/getCreditRateLimitStatus": "credit_rate_limit",
    "/api/v3/getInferenceTranscriptsUnreadCount": "transcript_lifecycle",
    "/api/v3/markInferenceTranscriptSeen": "transcript_lifecycle",
}
SUPPORT_AI = {
    "/api/v3/warmSearchCache": "retrieval_warmup",
    "/api/v3/warmVectorDBCache": "retrieval_warmup",
}
CORRELATED = {
    "/api/v3/saveTransactionsFanout": "generic_persistence",
    "/api/v3/syncRecordValuesSpaceInitial": "generic_record_hydration",
    "/api/v3/syncRecordValuesMain": "generic_record_hydration",
    "/api/v3/getAssetsJsonV2": "generic_asset_metadata",
    "/api/v3/etClient": "client_telemetry",
}


def classify(host: str, path: str) -> tuple[str, str]:
    if path in DIRECT_AI:
        return "direct", DIRECT_AI[path]
    if path in SUPPORT_AI:
        return "support", SUPPORT_AI[path]
    if path in CORRELATED:
        return "correlated", CORRELATED[path]
    if host == "exp.notion.com" or "sentry.io" in host or "splunkcloud.com" in host:
        return "telemetry", "peripheral_telemetry"
    if path.startswith("/_assets/"):
        return "asset", "browser_asset"
    return "none", "other"


def raw_hars(har_dir: Path = HAR_DIR) -> list[Path]:
    """Discover every owner-only raw capture via the shared safety rules."""
    return discover_raw_hars(har_dir)


def main() -> None:
    grouped: dict[tuple[str, str, str, str], dict] = {}
    captures: dict[str, dict] = {}
    host_counts: Counter[str] = Counter()
    total_entries = 0

    for path in raw_hars():
        document = load_har(path)
        entries = document.get("log", {}).get("entries", [])
        captures[path.name] = {
            "entries": len(entries),
            "bytes": path.stat().st_size,
        }
        total_entries += len(entries)
        for entry in entries:
            request = entry.get("request") or {}
            response = entry.get("response") or {}
            raw_url = str(request.get("url") or "")
            try:
                parsed = urlsplit(raw_url)
            except ValueError:
                parsed = urlsplit("")
            scheme = parsed.scheme or "unknown"
            host = (parsed.hostname or "<non-network>").lower()
            endpoint_path = parsed.path or "/"
            method = str(request.get("method") or "UNKNOWN")
            key = (scheme, host, endpoint_path, method)
            if key not in grouped:
                relevance, role = classify(host, endpoint_path)
                grouped[key] = {
                    "scheme": scheme,
                    "host": host,
                    "path": endpoint_path,
                    "method": method,
                    "ai_relevance": relevance,
                    "role": role,
                    "notion_api_v3": host == "app.notion.com" and endpoint_path.startswith("/api/v3/"),
                    "count": 0,
                    "capture_counts": Counter(),
                    "statuses": Counter(),
                    "mime_types": Counter(),
                    "query_parameter_names": set(),
                    "total_har_time_ms": 0.0,
                    "min_har_time_ms": None,
                    "max_har_time_ms": None,
                    "total_response_body_bytes": 0,
                }
            item = grouped[key]
            item["count"] += 1
            item["capture_counts"][path.name] += 1
            item["statuses"][str(response.get("status", "unknown"))] += 1
            mime = str((response.get("content") or {}).get("mimeType") or "")
            if mime:
                item["mime_types"][mime] += 1
            for name, _ in parse_qsl(parsed.query, keep_blank_values=True):
                item["query_parameter_names"].add(name)
            elapsed = entry.get("time")
            if isinstance(elapsed, (int, float)) and elapsed >= 0:
                value = float(elapsed)
                item["total_har_time_ms"] += value
                item["min_har_time_ms"] = value if item["min_har_time_ms"] is None else min(item["min_har_time_ms"], value)
                item["max_har_time_ms"] = value if item["max_har_time_ms"] is None else max(item["max_har_time_ms"], value)
            body_size = response.get("bodySize")
            if isinstance(body_size, int) and body_size > 0:
                item["total_response_body_bytes"] += body_size
            host_counts[host] += 1

    rows = []
    for item in grouped.values():
        count = item["count"]
        rows.append({
            **{k: item[k] for k in (
                "scheme", "host", "path", "method", "ai_relevance", "role", "notion_api_v3", "count"
            )},
            "capture_counts": dict(sorted(item["capture_counts"].items())),
            "statuses": dict(sorted(item["statuses"].items())),
            "mime_types": dict(sorted(item["mime_types"].items())),
            "query_parameter_names": sorted(item["query_parameter_names"]),
            "average_har_time_ms": round(item["total_har_time_ms"] / count, 3) if count else None,
            "min_har_time_ms": item["min_har_time_ms"],
            "max_har_time_ms": item["max_har_time_ms"],
            "total_response_body_bytes": item["total_response_body_bytes"],
        })
    rows.sort(key=lambda row: (row["host"], row["path"], row["method"]))

    generated_at = datetime.now(timezone.utc).isoformat()
    document = {
        "generated_at": generated_at,
        "privacy_boundary": "No headers, cookies, query values, or bodies are included.",
        "capture_files": captures,
        "entry_observations": total_entries,
        "unique_method_endpoints": len(rows),
        "endpoints": rows,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "network-endpoints.json"
    json_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    csv_path = OUT_DIR / "network-endpoints.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "scheme", "host", "path", "method", "ai_relevance", "role",
            "notion_api_v3", "count", "statuses", "mime_types",
            "query_parameter_names", "capture_counts", "average_har_time_ms",
            "min_har_time_ms", "max_har_time_ms", "total_response_body_bytes",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            rendered = dict(row)
            for name in ("statuses", "mime_types", "capture_counts"):
                rendered[name] = json.dumps(rendered[name], sort_keys=True, separators=(",", ":"))
            rendered["query_parameter_names"] = ";".join(rendered["query_parameter_names"])
            writer.writerow(rendered)

    direct_rows = [row for row in rows if row["ai_relevance"] in {"direct", "support", "correlated"}]
    ai_path = OUT_DIR / "ai-endpoints.json"
    ai_path.write_text(json.dumps({
        "generated_at": generated_at,
        "classification_note": "Direct routes are AI-specific by name and live trace role; support routes were concurrent retrieval warmups; correlated routes are generic calls observed in the AI flows.",
        "endpoints": direct_rows,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    ai_csv_path = OUT_DIR / "ai-endpoints.csv"
    with ai_csv_path.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "ai_relevance", "role", "method", "host", "path", "count",
            "statuses", "mime_types", "capture_counts", "average_har_time_ms",
            "min_har_time_ms", "max_har_time_ms",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in direct_rows:
            writer.writerow({
                **{name: row[name] for name in fieldnames if name not in {"statuses", "mime_types", "capture_counts"}},
                "statuses": json.dumps(row["statuses"], sort_keys=True, separators=(",", ":")),
                "mime_types": json.dumps(row["mime_types"], sort_keys=True, separators=(",", ":")),
                "capture_counts": json.dumps(row["capture_counts"], sort_keys=True, separators=(",", ":")),
            })

    summary = {
        "generated_at": generated_at,
        "raw_capture_files": len(captures),
        "entry_observations": total_entries,
        "unique_method_endpoints": len(rows),
        "unique_hosts": len(host_counts),
        "host_counts": dict(host_counts.most_common()),
        "ai_endpoint_counts": dict(Counter(row["ai_relevance"] for row in direct_rows)),
    }
    (OUT_DIR / "network-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
