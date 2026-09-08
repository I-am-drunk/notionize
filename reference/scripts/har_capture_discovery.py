#!/usr/bin/env python3
"""Shared, privacy-safe HAR discovery and structural validation helpers."""

from __future__ import annotations

import json
from pathlib import Path
import stat
from typing import Any


RAW_SUFFIX = ".har"
SANITIZED_SUFFIX = ".sanitized.har"


class CaptureDiscoveryError(ValueError):
    """Raised when capture discovery would be incomplete or unsafe."""


def is_sanitized_har(path: Path) -> bool:
    return path.name.casefold().endswith(SANITIZED_SUFFIX)


def is_har_name(path: Path) -> bool:
    return path.name.casefold().endswith(RAW_SUFFIX)


def sanitized_path_for(raw_path: Path) -> Path:
    if not is_har_name(raw_path) or is_sanitized_har(raw_path):
        raise CaptureDiscoveryError(f"not a raw HAR filename: {raw_path.name}")
    return raw_path.with_name(raw_path.name[: -len(RAW_SUFFIX)] + SANITIZED_SUFFIX)


def _reject_control_characters(path: Path) -> None:
    if any(ord(character) < 32 or ord(character) == 127 for character in path.name):
        raise CaptureDiscoveryError(
            f"HAR filename contains control characters: {path.name!r}"
        )


def require_private_regular_file(path: Path, label: str) -> None:
    if path.is_symlink():
        raise CaptureDiscoveryError(f"{label} must not be a symlink: {path}")
    if not path.exists() or not path.is_file():
        raise CaptureDiscoveryError(f"{label} is not a regular file: {path}")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode != 0o600:
        raise CaptureDiscoveryError(
            f"{label} must have mode 0600 before use; found {mode:04o}: {path}"
        )


def validate_raw_har_path(path: Path) -> Path:
    path = Path(path)
    _reject_control_characters(path)
    if not is_har_name(path) or is_sanitized_har(path):
        raise CaptureDiscoveryError(f"expected a raw *.har file: {path}")
    require_private_regular_file(path, "raw HAR")
    return path


def discover_raw_hars(
    har_dir: Path, *, require_nonempty: bool = True
) -> list[Path]:
    """Return every raw HAR exactly once, excluding sanitized derivatives.

    Discovery is deliberately non-recursive: captures must be placed directly
    in the archive's HAR directory. Any HAR-named symlink is an error rather
    than being silently followed or ignored.
    """
    har_dir = Path(har_dir)
    if har_dir.is_symlink() or not har_dir.is_dir():
        raise CaptureDiscoveryError(f"HAR directory is not a real directory: {har_dir}")

    raw_paths: list[Path] = []
    seen_names: dict[str, Path] = {}
    for path in har_dir.iterdir():
        if not is_har_name(path):
            continue
        _reject_control_characters(path)
        if path.is_symlink():
            raise CaptureDiscoveryError(f"HAR files must not be symlinks: {path}")
        if is_sanitized_har(path):
            continue
        validate_raw_har_path(path)
        folded = path.name.casefold()
        if folded in seen_names:
            raise CaptureDiscoveryError(
                "case-insensitive raw HAR filename collision: "
                f"{seen_names[folded].name!r} and {path.name!r}"
            )
        seen_names[folded] = path
        raw_paths.append(path)

    raw_paths.sort(key=lambda item: (item.name.casefold(), item.name))
    if require_nonempty and not raw_paths:
        raise CaptureDiscoveryError(f"no raw *.har captures found in {har_dir}")
    return raw_paths


def discover_capture_pairs(har_dir: Path) -> list[tuple[Path, Path]]:
    """Pair every discovered raw capture with its required sanitized HAR."""
    raw_paths = discover_raw_hars(har_dir)
    pairs: list[tuple[Path, Path]] = []
    missing: list[str] = []
    for raw_path in raw_paths:
        sanitized_path = sanitized_path_for(raw_path)
        if not sanitized_path.exists():
            missing.append(sanitized_path.name)
            continue
        require_private_regular_file(sanitized_path, "sanitized HAR")
        pairs.append((raw_path, sanitized_path))
    if missing:
        raise CaptureDiscoveryError(
            "raw capture(s) are missing sanitized derivatives: " + ", ".join(missing)
        )
    return pairs


def validate_har_document(document: Any, source: Path | str = "<memory>") -> None:
    """Validate the HAR envelope needed by the archive pipeline."""
    if not isinstance(document, dict):
        raise CaptureDiscoveryError(f"HAR root must be an object: {source}")
    log = document.get("log")
    if not isinstance(log, dict):
        raise CaptureDiscoveryError(f"HAR .log must be an object: {source}")
    entries = log.get("entries")
    if not isinstance(entries, list):
        raise CaptureDiscoveryError(f"HAR .log.entries must be an array: {source}")
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise CaptureDiscoveryError(
                f"HAR entry {index} must be an object: {source}"
            )
        if not isinstance(entry.get("request"), dict):
            raise CaptureDiscoveryError(
                f"HAR entry {index} has no request object: {source}"
            )
        if not isinstance(entry.get("response"), dict):
            raise CaptureDiscoveryError(
                f"HAR entry {index} has no response object: {source}"
            )


def load_har(path: Path) -> dict[str, Any]:
    path = Path(path)
    require_private_regular_file(path, "HAR")
    try:
        with path.open("r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CaptureDiscoveryError(f"cannot parse HAR JSON {path}: {error}") from error
    validate_har_document(document, path)
    return document
