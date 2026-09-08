#!/usr/bin/env python3
"""Privacy-sanitize HAR captures without destroying protocol evidence.

The sanitizer removes credential/session headers and HAR cookie objects,
pseudonymizes identifiers in URLs and structured bodies, and understands JSON,
NDJSON/SSE, form-encoded requests, and base64-encoded textual responses.

It deliberately preserves captured timing/size metadata, response prose, model
names/configuration values, and response event-type values. Placeholders are
stable within one input file but no source-to-placeholder map is written.
"""

from __future__ import annotations

import argparse
import base64
import binascii
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from typing import Any, Iterable
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from har_capture_discovery import (  # noqa: E402
    CaptureDiscoveryError,
    discover_raw_hars,
    load_har,
    sanitized_path_for,
    validate_raw_har_path,
)


EMAIL_RE = re.compile(
    r"(?<![A-Z0-9.!#$%&'*+/=?^_`{|}~-])"
    r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?"
    r"(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+",
    re.IGNORECASE,
)
UUID_RE = re.compile(
    r"(?<![0-9a-f])"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"(?![0-9a-f])",
    re.IGNORECASE,
)
COMPACT_ID_RE = re.compile(r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])", re.IGNORECASE)
JWT_RE = re.compile(
    r"(?<![A-Za-z0-9_-])"
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\."
    r"[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])"
)
BEARER_RE = re.compile(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/=-]{12,}")
TOKEN_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?:ntn|secret|token|sk|pk)[_-]"
    r"[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])"
)

SENSITIVE_HEADERS = {
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
    "x-csrf-token",
    "csrf-token",
    "x-xsrf-token",
    "x-notion-active-user-header",
    "x-notion-space-id",
    "x-notion-space-short-id",
    "x-notion-user-id",
    "x-notion-request-id",
    "sentry-trace",
    "baggage",
    "traceparent",
    "tracestate",
    "x-amzn-trace-id",
    "x-amzn-requestid",
    "x-amz-request-id",
    "x-amz-id-2",
    "cf-ray",
    "sec-websocket-key",
    "sec-websocket-accept",
    "www-authenticate",
    "proxy-authenticate",
}

CREDENTIAL_KEYS = {
    "authorization",
    "proxy_authorization",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "access_key",
    "secret_key",
    "access_token",
    "refresh_token",
    "auth_token",
    "id_token",
    "session_token",
    "csrf_token",
    "xsrf_token",
    "cookie",
    "cookies",
    "credential",
    "credentials",
}

IDENTIFIER_KEYS = {
    "id",
    "ids",
    "uuid",
    "uuids",
    "workspace",
    "workspace_id",
    "space",
    "space_id",
    "spaceid",
    "space_domain",
    "page_id",
    "pageid",
    "user_id",
    "userid",
    "person_id",
    "member_id",
    "transcript_id",
    "transcriptid",
    "thread_id",
    "threadid",
    "conversation_id",
    "conversationid",
    "chat_id",
    "chatid",
    "message_id",
    "messageid",
    "session_id",
    "sessionid",
    "inference_id",
    "inferenceid",
    "device_id",
    "deviceid",
    "tab_id",
    "tabid",
    "request_id",
    "requestid",
    "trace_id",
    "traceid",
    "event_id",
    "eventid",
    "insert_id",
    "insertid",
    "client_initialization_id",
    "shared_uuid",
    "ip",
    "ip_address",
}

EMAIL_KEYS = {
    "email",
    "user_email",
    "member_email",
    "owner_email",
    "person_email",
}

PERSON_NAME_KEYS = {
    "user_name",
    "username",
    "display_name",
    "full_name",
    "given_name",
    "family_name",
}

URL_KEYS = {
    "url",
    "uri",
    "href",
    "referrer",
    "referer",
    "redirect_url",
    "redirecturl",
    "return_url",
    "callback_url",
    "location",
}

QUERY_SENSITIVE_KEYS = {
    "q",
    "query",
    "search",
    "prompt",
    "cursor",
    "continuation",
    "nonce",
    "signature",
    "sig",
    "key",
    "hash",
}

QUERY_SAFE_OPAQUE_KEYS = {
    "model",
    "format",
    "type",
    "locale",
    "language",
    "lang",
    "limit",
    "page_size",
    "sort",
    "order",
    "version",
    "v",
    "environment",
    "source",
    "mode",
    "action",
    "platform",
    "client_version",
    "notion_client_version",
}

RESPONSE_TEXT_KEYS = {
    "text",
    "plain_text",
    "markdown",
    "content",
    "message",
    "answer",
    "completion",
    "output",
    "title",
    "description",
    "label",
    "header_label",
    "headerlabel",
}

EVENT_TYPE_KEYS = {
    "type",
    "event",
    "event_type",
    "eventtype",
    "object",
}


def normalize_key(key: str) -> str:
    key = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    key = re.sub(r"[^A-Za-z0-9]+", "_", key)
    return key.strip("_").casefold()


def identifier_kind(key: str) -> str | None:
    norm = normalize_key(key)
    if norm in CREDENTIAL_KEYS:
        return "credential"
    if (
        norm.endswith("_token")
        or norm.endswith("_secret")
        or norm.endswith("_password")
        or norm.endswith("_api_key")
    ):
        return "credential"
    if norm in EMAIL_KEYS or norm.endswith("_email"):
        return "email"
    if norm in PERSON_NAME_KEYS:
        return "person_name"
    if norm in IDENTIFIER_KEYS or norm.endswith("_id") or norm.endswith("_ids"):
        return norm or "identifier"
    return None


def header_is_sensitive(name: str) -> bool:
    norm = name.strip().casefold()
    if norm in SENSITIVE_HEADERS:
        return True
    return bool(
        re.search(
            r"(?:^|[-_])(?:auth|authorization|token|secret|cookie|session|csrf|xsrf)"
            r"(?:$|[-_])",
            norm,
        )
    )


def intrinsic_string_kind(value: str) -> str | None:
    if EMAIL_RE.fullmatch(value):
        return "email"
    if UUID_RE.fullmatch(value):
        return "uuid"
    if COMPACT_ID_RE.fullmatch(value):
        return "notion_id"
    if JWT_RE.fullmatch(value) or TOKEN_RE.fullmatch(value):
        return "token"
    return None


def semantic_key_kind(key: str, context: str) -> str | None:
    """Return a protected semantic class, after privacy keys take priority."""
    if context != "response" or identifier_kind(key):
        return None
    norm = normalize_key(key)
    if "model" in norm:
        return "model_value"
    if norm in EVENT_TYPE_KEYS or norm.endswith("_event_type"):
        return "event_type_value"
    if norm in RESPONSE_TEXT_KEYS:
        return "response_text_value"
    return None


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((n / length) * math.log2(n / length) for n in counts.values())


def split_line_ending(line: str) -> tuple[str, str]:
    if line.endswith("\r\n"):
        return line[:-2], "\r\n"
    if line.endswith("\n") or line.endswith("\r"):
        return line[:-1], line[-1]
    return line, ""


class Sanitizer:
    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self._tokens: dict[tuple[str, str], str] = {}
        self._kind_sequences: Counter[str] = Counter()

    def token(self, kind: str, raw: str) -> str:
        kind = re.sub(r"[^a-z0-9]+", "_", kind.casefold()).strip("_") or "value"
        map_key = (kind, raw)
        if map_key not in self._tokens:
            self._kind_sequences[kind] += 1
            seq = self._kind_sequences[kind]
            self._tokens[map_key] = f"__REDACTED_{kind.upper()}_{seq:04d}__"
        self.counts[f"redactions.{kind}"] += 1
        return self._tokens[map_key]

    @property
    def unique_placeholder_count(self) -> int:
        return len(self._tokens)

    def redact_scalar(self, value: Any, kind: str) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            actual_kind = intrinsic_string_kind(value) or kind
            return self.token(actual_kind, value)
        self.counts[f"redactions.{kind}"] += 1
        if isinstance(value, bool):
            return False
        if isinstance(value, int):
            self._kind_sequences[f"numeric_{kind}"] += 1
            return -self._kind_sequences[f"numeric_{kind}"]
        if isinstance(value, float):
            self._kind_sequences[f"numeric_{kind}"] += 1
            return -float(self._kind_sequences[f"numeric_{kind}"])
        return value

    def redact_all(self, value: Any, kind: str) -> Any:
        if isinstance(value, dict):
            result: dict[str, Any] = {}
            for key, item in value.items():
                new_key = self.sanitize_dynamic_key(str(key))
                result[new_key] = self.redact_all(item, kind)
            return result
        if isinstance(value, list):
            return [self.redact_all(item, kind) for item in value]
        return self.redact_scalar(value, kind)

    def redact_identifier_value(self, value: Any, kind: str, context: str) -> Any:
        if isinstance(value, dict):
            return self.sanitize_json(value, context=context)
        if isinstance(value, list):
            return [
                self.sanitize_json(item, context=context)
                if isinstance(item, (dict, list))
                else self.redact_scalar(item, kind)
                for item in value
            ]
        return self.redact_scalar(value, kind)

    def sanitize_inline(self, value: str) -> str:
        def replace(pattern: re.Pattern[str], kind: str, text: str) -> str:
            return pattern.sub(lambda match: self.token(kind, match.group(0)), text)

        value = self.sanitize_token_patterns(value)
        value = replace(EMAIL_RE, "email", value)
        value = replace(UUID_RE, "uuid", value)
        value = replace(COMPACT_ID_RE, "notion_id", value)
        return value

    def sanitize_token_patterns(self, value: str) -> str:
        """Redact explicit credential shapes without changing surrounding prose."""
        value = BEARER_RE.sub(
            lambda match: self.token("bearer_token", match.group(0)), value
        )
        value = JWT_RE.sub(lambda match: self.token("jwt", match.group(0)), value)
        value = TOKEN_RE.sub(lambda match: self.token("token", match.group(0)), value)
        return value

    def sanitize_dynamic_key(self, key: str) -> str:
        sanitized = self.sanitize_inline(key)
        if sanitized != key:
            self.counts["json.dynamic_keys_changed"] += 1
        return sanitized

    def semantic_kind(self, key: str, context: str) -> str | None:
        return semantic_key_kind(key, context)

    def preserve_semantic(self, value: Any, preserve_kind: str, context: str) -> Any:
        if isinstance(value, str):
            self.counts[f"preserved.{preserve_kind}"] += 1
            return value
        if isinstance(value, list):
            return [
                self.preserve_semantic(item, preserve_kind, context)
                if not isinstance(item, dict)
                else self.sanitize_json(item, context=context)
                for item in value
            ]
        if isinstance(value, dict):
            return self.sanitize_json(value, context=context)
        return value

    def sanitize_json(self, value: Any, context: str) -> Any:
        if isinstance(value, dict):
            result: dict[str, Any] = {}
            for raw_key, item in value.items():
                key = str(raw_key)
                new_key = self.sanitize_dynamic_key(key)
                if new_key in result:
                    raise ValueError(f"redaction caused a JSON key collision at {new_key!r}")
                sensitive_kind = identifier_kind(key)
                semantic_kind = self.semantic_kind(key, context)
                norm = normalize_key(key)
                if sensitive_kind == "credential":
                    result[new_key] = self.redact_all(item, sensitive_kind)
                elif sensitive_kind:
                    result[new_key] = self.redact_identifier_value(
                        item, sensitive_kind, context
                    )
                elif norm in URL_KEYS and isinstance(item, str):
                    result[new_key] = self.sanitize_url(item)
                elif semantic_kind:
                    result[new_key] = self.preserve_semantic(
                        item, semantic_kind, context
                    )
                else:
                    result[new_key] = self.sanitize_json(item, context=context)
            return result
        if isinstance(value, list):
            return [self.sanitize_json(item, context=context) for item in value]
        if isinstance(value, str):
            return self.sanitize_inline(value)
        return value

    def query_key_is_sensitive(self, key: str) -> bool:
        norm = normalize_key(key)
        return bool(identifier_kind(key) or norm in QUERY_SENSITIVE_KEYS)

    def sanitize_query_value(self, key: str, value: str) -> str:
        norm = normalize_key(key)
        if self.query_key_is_sensitive(key):
            self.counts["query.sensitive_values"] += 1
            return self.redact_scalar(value, f"query_{norm or 'value'}")

        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                parsed = json.loads(value)
            except (json.JSONDecodeError, UnicodeError):
                pass
            else:
                self.counts["query.json_values"] += 1
                sanitized = self.sanitize_json(parsed, context="request")
                return json.dumps(
                    sanitized, ensure_ascii=False, separators=(",", ":"), allow_nan=False
                )

        sanitized = self.sanitize_inline(value)
        if sanitized != value:
            self.counts["query.pattern_values"] += 1
            return sanitized
        if (
            norm not in QUERY_SAFE_OPAQUE_KEYS
            and len(value) >= 32
            and re.fullmatch(r"[A-Za-z0-9._~+/=-]+", value)
            and shannon_entropy(value) >= 3.7
        ):
            self.counts["query.opaque_values"] += 1
            return self.token("query_opaque", value)
        return value

    def sanitize_url(self, value: str) -> str:
        try:
            parts = urlsplit(value)
        except ValueError:
            self.counts["url.parse_failures"] += 1
            return self.sanitize_inline(value)

        netloc = parts.netloc
        if parts.username is not None:
            host = parts.hostname or ""
            if ":" in host and not host.startswith("["):
                host = f"[{host}]"
            if parts.port is not None:
                host = f"{host}:{parts.port}"
            netloc = host
            self.counts["url.userinfo_removed"] += 1

        path_segments = parts.path.split("/")
        changed_segments: list[str] = []
        for segment in path_segments:
            decoded = unquote(segment)
            sanitized = self.sanitize_inline(decoded)
            changed_segments.append(quote(sanitized, safe="!$&'()*+,;=:@-._~"))
        path = "/".join(changed_segments)

        query_pairs: list[tuple[str, str]] = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            query_pairs.append((key, self.sanitize_query_value(key, item)))
        query = urlencode(query_pairs, doseq=True)
        fragment = self.sanitize_inline(unquote(parts.fragment))
        fragment = quote(fragment, safe="!$&'()*+,;=:@/?-._~")
        sanitized = urlunsplit((parts.scheme, netloc, path, query, fragment))
        if sanitized != value:
            self.counts["url.values_changed"] += 1
        return sanitized

    def sanitize_headers(self, headers: Any, side: str) -> list[Any]:
        if not isinstance(headers, list):
            return [] if headers is None else headers
        result: list[Any] = []
        for header in headers:
            if not isinstance(header, dict):
                result.append(header)
                continue
            name = str(header.get("name", ""))
            if header_is_sensitive(name):
                self.counts["headers.removed"] += 1
                self.counts[f"headers.removed.{name.casefold() or 'unnamed'}"] += 1
                continue
            copied = dict(header)
            value = copied.get("value")
            if isinstance(value, str) and name.casefold() in {
                "referer",
                "referrer",
                "origin",
                "location",
                "content-location",
            }:
                copied["value"] = self.sanitize_url(value)
            elif isinstance(value, str) and name.casefold() in {
                "content-disposition",
                "link",
            }:
                copied["value"] = self.sanitize_inline(value)
            result.append(copied)
        self.counts[f"headers.{side}_lists"] += 1
        return result

    def clear_cookies(self, holder: dict[str, Any], side: str) -> None:
        cookies = holder.get("cookies")
        if isinstance(cookies, list):
            self.counts["cookies.removed"] += len(cookies)
            self.counts[f"cookies.{side}_arrays_cleared"] += 1
            holder["cookies"] = []

    def sanitize_params(self, params: Any, context: str) -> Any:
        if not isinstance(params, list):
            return params
        result: list[Any] = []
        for param in params:
            if not isinstance(param, dict):
                result.append(param)
                continue
            copied = dict(param)
            name = str(copied.get("name", ""))
            if "value" in copied:
                item = copied["value"]
                if self.query_key_is_sensitive(name):
                    copied["value"] = self.redact_identifier_value(
                        item, f"form_{normalize_key(name) or 'value'}", context
                    )
                    self.counts["form.sensitive_values"] += 1
                elif isinstance(item, str):
                    copied["value"] = self.sanitize_inline(item)
            if isinstance(copied.get("fileName"), str):
                copied["fileName"] = self.sanitize_inline(copied["fileName"])
            result.append(copied)
        return result

    def sanitize_line_stream(self, text: str, context: str) -> tuple[str, bool]:
        changed = False
        parsed_lines = 0
        output: list[str] = []
        for line in text.splitlines(keepends=True):
            body, ending = split_line_ending(line)
            prefix = ""
            payload = body
            if body.startswith("data:"):
                prefix = "data:"
                payload = body[len(prefix) :]
                if payload.startswith(" "):
                    prefix += " "
                    payload = payload[1:]
            if not payload.strip() or payload.strip() == "[DONE]":
                output.append(body + ending)
                continue
            try:
                parsed = json.loads(payload)
            except (json.JSONDecodeError, UnicodeError):
                output.append(body + ending)
                continue
            sanitized = self.sanitize_json(parsed, context=context)
            rendered = json.dumps(
                sanitized, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            )
            output.append(prefix + rendered + ending)
            parsed_lines += 1
            changed = changed or rendered != payload
        self.counts[f"bodies.{context}.stream_json_lines"] += parsed_lines
        return "".join(output), changed

    def sanitize_form_text(self, text: str) -> str:
        result: list[tuple[str, str]] = []
        for key, value in parse_qsl(text, keep_blank_values=True):
            result.append((key, self.sanitize_query_value(key, value)))
        self.counts["bodies.request.form_encoded"] += 1
        return urlencode(result, doseq=True)

    def sanitize_text_body(self, text: str, mime: str, context: str) -> tuple[str, bool]:
        mime_base = mime.partition(";")[0].strip().casefold()
        stripped = text.lstrip("\ufeff \t\r\n")
        looks_json = stripped.startswith(("{", "["))
        json_mime = "json" in mime_base and "ndjson" not in mime_base

        if looks_json or json_mime:
            try:
                parsed = json.loads(text)
            except (json.JSONDecodeError, UnicodeError):
                if json_mime:
                    self.counts[f"bodies.{context}.json_parse_failures"] += 1
            else:
                sanitized = self.sanitize_json(parsed, context=context)
                rendered = json.dumps(
                    sanitized, ensure_ascii=False, separators=(",", ":"), allow_nan=False
                )
                self.counts[f"bodies.{context}.json_documents"] += 1
                return rendered, rendered != text

        if "ndjson" in mime_base or mime_base == "application/jsonlines" or "event-stream" in mime_base:
            rendered, changed = self.sanitize_line_stream(text, context=context)
            self.counts[f"bodies.{context}.line_streams"] += 1
            return rendered, changed

        if context == "request" and mime_base == "application/x-www-form-urlencoded":
            rendered = self.sanitize_form_text(text)
            return rendered, rendered != text

        if context == "response" and mime_base in {
            "text/html",
            "application/xhtml+xml",
            "application/xml",
            "text/xml",
        }:
            # HTML/XML can embed live session material in scripts or markup.
            # Only explicit credential shapes are touched here; general prose
            # remains intact and JavaScript source assets remain out of scope.
            rendered = self.sanitize_token_patterns(text)
            if rendered != text:
                self.counts["bodies.response.opaque_token_documents"] += 1
            return rendered, rendered != text

        # HAR exporters and third-party SDKs sometimes label textual telemetry
        # or multipart envelopes as application/octet-stream. Even when the
        # surrounding body is deliberately left opaque, explicit bearer/JWT/
        # API-token shapes must not survive into a sanitized derivative.
        rendered = self.sanitize_token_patterns(text)
        if rendered != text:
            self.counts[f"bodies.{context}.opaque_token_documents"] += 1
        return rendered, rendered != text

    def sanitize_post_data(self, post_data: Any) -> Any:
        if not isinstance(post_data, dict):
            return post_data
        result = dict(post_data)
        mime = str(result.get("mimeType", ""))
        if isinstance(result.get("text"), str):
            result["text"], changed = self.sanitize_text_body(
                result["text"], mime, context="request"
            )
            if changed:
                self.counts["bodies.request.changed"] += 1
        if "params" in result:
            result["params"] = self.sanitize_params(result["params"], context="request")
        return result

    def sanitize_response_content(self, content: Any) -> Any:
        if not isinstance(content, dict):
            return content
        result = dict(content)
        text = result.get("text")
        if not isinstance(text, str):
            return result
        mime = str(result.get("mimeType", ""))
        encoding = str(result.get("encoding", "")).casefold()

        if encoding == "base64" and (
            "json" in mime.casefold()
            or "ndjson" in mime.casefold()
            or "event-stream" in mime.casefold()
        ):
            try:
                decoded_bytes = base64.b64decode(text, validate=True)
                decoded = decoded_bytes.decode("utf-8")
            except (binascii.Error, UnicodeDecodeError, ValueError):
                # Firefox exports sometimes retain encoding="base64" after it
                # has already decoded a textual response. Sanitize that text
                # in place and preserve the capture's original metadata.
                self.counts["bodies.response.base64_label_raw_text_fallbacks"] += 1
                rendered, changed = self.sanitize_text_body(
                    text, mime, context="response"
                )
                if changed:
                    result["text"] = rendered
                    self.counts["bodies.response.changed"] += 1
                return result
            rendered, changed = self.sanitize_text_body(decoded, mime, context="response")
            self.counts["bodies.response.base64_text_documents"] += 1
            if changed:
                result["text"] = base64.b64encode(rendered.encode("utf-8")).decode("ascii")
                self.counts["bodies.response.changed"] += 1
            return result

        rendered, changed = self.sanitize_text_body(text, mime, context="response")
        if changed:
            result["text"] = rendered
            self.counts["bodies.response.changed"] += 1
        return result

    def sanitize_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        result = dict(entry)
        request = dict(result.get("request") or {})
        response = dict(result.get("response") or {})

        request["headers"] = self.sanitize_headers(request.get("headers"), "request")
        response["headers"] = self.sanitize_headers(response.get("headers"), "response")
        self.clear_cookies(request, "request")
        self.clear_cookies(response, "response")

        if isinstance(request.get("url"), str):
            request["url"] = self.sanitize_url(request["url"])
        query_string = request.get("queryString")
        if isinstance(query_string, list):
            sanitized_query: list[Any] = []
            for pair in query_string:
                if not isinstance(pair, dict):
                    sanitized_query.append(pair)
                    continue
                copied = dict(pair)
                name = str(copied.get("name", ""))
                if isinstance(copied.get("value"), str):
                    copied["value"] = self.sanitize_query_value(name, copied["value"])
                sanitized_query.append(copied)
            request["queryString"] = sanitized_query

        if "postData" in request:
            request["postData"] = self.sanitize_post_data(request["postData"])
        if isinstance(response.get("redirectURL"), str):
            response["redirectURL"] = self.sanitize_url(response["redirectURL"])
        if "content" in response:
            response["content"] = self.sanitize_response_content(response["content"])

        result["request"] = request
        result["response"] = response
        self.counts["entries.processed"] += 1
        return result

    def sanitize_har(self, document: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(document, dict) or not isinstance(document.get("log"), dict):
            raise ValueError("input is not a HAR object with a .log object")
        result = dict(document)
        log = dict(result["log"])
        entries = log.get("entries")
        if not isinstance(entries, list):
            raise ValueError("input HAR does not contain a .log.entries array")
        log["entries"] = [
            self.sanitize_entry(entry) if isinstance(entry, dict) else entry
            for entry in entries
        ]

        pages = log.get("pages")
        if isinstance(pages, list):
            sanitized_pages: list[Any] = []
            for page in pages:
                if not isinstance(page, dict):
                    sanitized_pages.append(page)
                    continue
                copied = dict(page)
                if isinstance(copied.get("title"), str):
                    copied["title"] = self.sanitize_url(copied["title"])
                sanitized_pages.append(copied)
            log["pages"] = sanitized_pages

        result["log"] = log
        return result


def timing_snapshot(document: dict[str, Any]) -> Any:
    log = document.get("log", {})
    pages = log.get("pages", [])
    entries = log.get("entries", [])
    return {
        "pages": [
            {
                "startedDateTime": page.get("startedDateTime"),
                "pageTimings": page.get("pageTimings"),
            }
            for page in pages
            if isinstance(page, dict)
        ],
        "entries": [
            {
                "startedDateTime": entry.get("startedDateTime"),
                "time": entry.get("time"),
                "timings": entry.get("timings"),
            }
            for entry in entries
            if isinstance(entry, dict)
        ],
    }


def shape_signature(value: Any) -> Any:
    if isinstance(value, dict):
        return ("dict", len(value), tuple(shape_signature(item) for item in value.values()))
    if isinstance(value, list):
        return ("list", len(value), tuple(shape_signature(item) for item in value))
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    return type(value).__name__


def iter_structured_bodies(document: dict[str, Any]) -> Iterable[tuple[str, Any]]:
    for entry in document.get("log", {}).get("entries", []):
        if not isinstance(entry, dict):
            continue
        request = entry.get("request", {})
        post = request.get("postData", {}) if isinstance(request, dict) else {}
        text = post.get("text") if isinstance(post, dict) else None
        if isinstance(text, str):
            try:
                yield "request", json.loads(text)
            except (json.JSONDecodeError, UnicodeError):
                pass
        response = entry.get("response", {})
        content = response.get("content", {}) if isinstance(response, dict) else {}
        text = content.get("text") if isinstance(content, dict) else None
        if not isinstance(text, str):
            continue
        if str(content.get("encoding", "")).casefold() == "base64" and (
            "json" in str(content.get("mimeType", "")).casefold()
            or "ndjson" in str(content.get("mimeType", "")).casefold()
        ):
            try:
                text = base64.b64decode(text, validate=True).decode("utf-8")
            except (binascii.Error, UnicodeDecodeError, ValueError):
                # See sanitize_response_content: some Firefox HARs label an
                # already-decoded Unicode body as base64.
                pass
        try:
            yield "response", json.loads(text)
            continue
        except (json.JSONDecodeError, UnicodeError):
            pass
        for line in text.splitlines():
            payload = line
            if payload.startswith("data:"):
                payload = payload[5:].lstrip()
            try:
                yield "response", json.loads(payload)
            except (json.JSONDecodeError, UnicodeError):
                continue


def structured_shape_digest(document: dict[str, Any]) -> tuple[int, str]:
    hasher = hashlib.sha256()
    count = 0
    for context, body in iter_structured_bodies(document):
        signature = repr((context, shape_signature(body))).encode("utf-8")
        hasher.update(len(signature).to_bytes(8, "big"))
        hasher.update(signature)
        count += 1
    return count, hasher.hexdigest()


def iter_preserved_container(value: Any, kind: str) -> Iterable[tuple[str, Any]]:
    """Mirror Sanitizer.preserve_semantic without exposing collected values."""
    if isinstance(value, dict):
        yield from iter_response_semantics(value)
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                yield from iter_response_semantics(item)
            else:
                yield from iter_preserved_container(item, kind)
    elif isinstance(value, str):
        yield kind, value


def iter_response_semantics(value: Any) -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            kind = semantic_key_kind(str(key), context="response")
            if kind:
                yield from iter_preserved_container(item, kind)
            else:
                yield from iter_response_semantics(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_response_semantics(item)


def response_semantic_digest(document: dict[str, Any]) -> tuple[dict[str, int], str]:
    """Hash protected response strings so validation never prints their text."""
    hasher = hashlib.sha256()
    counts: Counter[str] = Counter()
    for context, body in iter_structured_bodies(document):
        if context != "response":
            continue
        for kind, value in iter_response_semantics(body):
            encoded = json.dumps(
                value, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            ).encode("utf-8")
            kind_bytes = kind.encode("ascii")
            hasher.update(len(kind_bytes).to_bytes(4, "big"))
            hasher.update(kind_bytes)
            hasher.update(len(encoded).to_bytes(8, "big"))
            hasher.update(encoded)
            counts[kind] += 1
    return dict(sorted(counts.items())), hasher.hexdigest()


def validate_sanitized(document: dict[str, Any]) -> dict[str, Any]:
    entries = document.get("log", {}).get("entries", [])
    sensitive_headers: list[str] = []
    cookie_objects = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for side in ("request", "response"):
            holder = entry.get(side, {})
            if not isinstance(holder, dict):
                continue
            for header in holder.get("headers", []):
                if isinstance(header, dict) and header_is_sensitive(
                    str(header.get("name", ""))
                ):
                    sensitive_headers.append(str(header.get("name", "")))
            cookies = holder.get("cookies", [])
            if isinstance(cookies, list):
                cookie_objects += len(cookies)
    if sensitive_headers:
        raise ValueError(f"sensitive headers remain: {sorted(set(sensitive_headers))}")
    if cookie_objects:
        raise ValueError(f"{cookie_objects} HAR cookie objects remain")
    return {
        "sensitive_headers_remaining": 0,
        "cookie_objects_remaining": 0,
    }


def default_output_path(source: Path) -> Path:
    return sanitized_path_for(source)


def sanitize_file(source: Path, output: Path, compact: bool) -> dict[str, Any]:
    if source.resolve() == output.resolve():
        raise ValueError("refusing to overwrite the source HAR")
    if output.is_symlink():
        raise ValueError(f"refusing to replace a symlink output: {output}")
    if output.exists() and not output.is_file():
        raise ValueError(f"sanitized output is not a regular file: {output}")
    original = load_har(source)

    original_timing = timing_snapshot(original)
    original_body_count, original_shape = structured_shape_digest(original)
    original_semantic_counts, original_semantic_digest = response_semantic_digest(original)
    sanitizer = Sanitizer()
    sanitized = sanitizer.sanitize_har(original)

    if timing_snapshot(sanitized) != original_timing:
        raise ValueError("internal validation failed: timing data changed")
    sanitized_body_count, sanitized_shape = structured_shape_digest(sanitized)
    if (original_body_count, original_shape) != (sanitized_body_count, sanitized_shape):
        raise ValueError("internal validation failed: structured body shape changed")
    sanitized_semantic_counts, sanitized_semantic_digest = response_semantic_digest(
        sanitized
    )
    if (
        original_semantic_counts != sanitized_semantic_counts
        or original_semantic_digest != sanitized_semantic_digest
    ):
        raise ValueError(
            "internal validation failed: response text/model/event values changed"
        )
    validation = validate_sanitized(sanitized)

    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            if compact:
                json.dump(
                    sanitized,
                    handle,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    allow_nan=False,
                )
            else:
                json.dump(
                    sanitized,
                    handle,
                    ensure_ascii=False,
                    indent=2,
                    allow_nan=False,
                )
                handle.write("\n")
        with open(temporary_name, "r", encoding="utf-8") as handle:
            reloaded = json.load(handle)
        if timing_snapshot(reloaded) != original_timing:
            raise ValueError("on-disk validation failed: timing data changed")
        reloaded_semantic_counts, reloaded_semantic_digest = response_semantic_digest(
            reloaded
        )
        if (
            reloaded_semantic_counts != original_semantic_counts
            or reloaded_semantic_digest != original_semantic_digest
        ):
            raise ValueError(
                "on-disk validation failed: response text/model/event values changed"
            )
        validate_sanitized(reloaded)
        os.replace(temporary_name, output)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise

    return {
        "input": str(source),
        "output": str(output),
        "input_bytes": source.stat().st_size,
        "output_bytes": output.stat().st_size,
        "entries": sanitizer.counts["entries.processed"],
        "structured_bodies_shape_checked": original_body_count,
        "unique_placeholders": sanitizer.unique_placeholder_count,
        "validation": {
            "json_reloaded": True,
            "timing_preserved": True,
            "structured_body_shapes_preserved": True,
            "response_text_model_event_values_preserved": True,
            "protected_response_value_counts": original_semantic_counts,
            **validation,
        },
        "counts": dict(sorted(sanitizer.counts.items())),
    }


def resolve_input_sources(
    explicit_inputs: Iterable[Path],
    discover_dir: Path | None = None,
    *,
    missing_only: bool = False,
) -> list[Path]:
    """Resolve explicit/discovered raw inputs once, in deterministic order."""
    if missing_only and discover_dir is None:
        raise CaptureDiscoveryError("--missing-only requires --discover")

    candidates = [validate_raw_har_path(Path(path)) for path in explicit_inputs]
    if discover_dir is not None:
        candidates.extend(discover_raw_hars(discover_dir))

    result: list[Path] = []
    seen: dict[Path, Path] = {}
    for candidate in candidates:
        identity = candidate.resolve()
        if identity in seen:
            raise CaptureDiscoveryError(
                f"raw HAR selected more than once: {candidate} (also {seen[identity]})"
            )
        seen[identity] = candidate
        if missing_only and default_output_path(candidate).exists():
            # Existing derivatives are skipped only after their privacy mode,
            # regular-file status, JSON syntax, and HAR envelope validate.
            load_har(default_output_path(candidate))
            continue
        result.append(candidate)

    if discover_dir is None:
        result.sort(key=lambda item: (item.name.casefold(), item.name))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="*", type=Path, help="explicit raw HAR file(s)")
    parser.add_argument(
        "--discover",
        action="store_true",
        help="discover every raw *.har in --har-dir, excluding sanitized HARs",
    )
    parser.add_argument(
        "--har-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="capture directory used by --discover (defaults to this script's directory)",
    )
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="with --discover, sanitize only raw HARs with no derived output yet",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="output path (valid only when exactly one input is supplied)",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="write compact JSON instead of readable two-space-indented JSON",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    discover_dir = args.har_dir if args.discover else None
    sources = resolve_input_sources(
        args.inputs, discover_dir=discover_dir, missing_only=args.missing_only
    )
    if not sources and not (args.discover and args.missing_only):
        raise SystemExit("provide a raw HAR input or use --discover")
    if args.output is not None and len(sources) != 1:
        raise SystemExit("--output requires exactly one input")
    reports: list[dict[str, Any]] = []
    for source in sources:
        output = args.output if args.output is not None else default_output_path(source)
        reports.append(sanitize_file(source, output, compact=args.compact))
    print(json.dumps(reports, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
