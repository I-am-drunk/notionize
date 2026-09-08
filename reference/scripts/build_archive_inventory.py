#!/usr/bin/env python3
"""Generate a deterministic size/SHA-256 inventory for the Notionize archive."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


ROOT = Path("/Users/irene/Documents/Notionize")
REFERENCE = ROOT / "reference"
JSON_OUTPUT = REFERENCE / "analysis" / "archive-inventory.json"
SHA_OUTPUT = REFERENCE / "analysis" / "ARCHIVE_MANIFEST.sha256"
EXCLUDE = {
    JSON_OUTPUT.resolve(),
    SHA_OUTPUT.resolve(),
}


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    files = []
    # Inventory the central report as well as every artifact under reference/.
    # The two generated integrity files are excluded to avoid recursive hashes.
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.resolve() in EXCLUDE:
            continue
        relative = path.relative_to(ROOT).as_posix()
        files.append({
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        })
    total_bytes = sum(item["bytes"] for item in files)
    document = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "root": str(ROOT),
        "file_count": len(files),
        "total_bytes": total_bytes,
        "files": files,
    }
    JSON_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SHA_OUTPUT.write_text(
        "".join(f'{item["sha256"]}  {item["path"]}\n' for item in files),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
