#!/usr/bin/env python3
"""Extract the non-personal Notion AI model-picker payload from a local HAR."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
from pathlib import Path


ROOT = Path("/Users/irene/Documents/Notionize/reference")
SOURCE = ROOT / "har" / "ai-probe-auto.har"
OUT = ROOT / "analysis"


def main() -> None:
    with SOURCE.open("r", encoding="utf-8") as handle:
        har = json.load(handle)
    payload = None
    for entry in har.get("log", {}).get("entries", []):
        if "/api/v3/getAvailableModels" not in str(entry.get("request", {}).get("url", "")):
            continue
        text = entry.get("response", {}).get("content", {}).get("text")
        if isinstance(text, str):
            candidate = json.loads(text)
            if isinstance(candidate, dict) and isinstance(candidate.get("models"), list):
                payload = candidate
                break
    if payload is None:
        raise SystemExit("getAvailableModels response not found")

    models = sorted(payload["models"], key=lambda item: (
        str(item.get("modelProvider", "")), str(item.get("modelMessage", "")), str(item.get("model", ""))
    ))
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE.name,
        "privacy_boundary": "The model-picker response contains no account/workspace identifiers; request data and headers are omitted.",
        "restrictedGeoPolicyApplied": payload.get("restrictedGeoPolicyApplied"),
        "restrictedAccessModelsInPickerConfig": payload.get("restrictedAccessModelsInPickerConfig", []),
        "model_count": len(models),
        "models": models,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "model-roster.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    with (OUT / "model-roster.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = [
            "display_name", "internal_alias", "family", "provider", "display_group",
            "disabled", "reasoning_efforts", "default_reasoning_effort",
            "speed", "intelligence", "cost", "workflow_model", "workflow_beta",
            "custom_agent_model", "agent_service_model",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for model in models:
            config = model.get("modelConfiguration") or {}
            card = model.get("modelCardAttributes") or {}
            workflow = model.get("workflow") or {}
            custom_agent = model.get("customAgent") or {}
            agent_service = model.get("agentService") or {}
            writer.writerow({
                "display_name": model.get("modelMessage"),
                "internal_alias": model.get("model"),
                "family": model.get("modelFamily"),
                "provider": model.get("modelProvider"),
                "display_group": model.get("displayGroup"),
                "disabled": model.get("isDisabled"),
                "reasoning_efforts": ";".join(config.get("supportedReasoningEfforts") or []),
                "default_reasoning_effort": config.get("defaultReasoningEffort"),
                "speed": card.get("speed"),
                "intelligence": card.get("intelligence"),
                "cost": card.get("cost"),
                "workflow_model": workflow.get("finalModelName"),
                "workflow_beta": workflow.get("beta"),
                "custom_agent_model": custom_agent.get("finalModelName"),
                "agent_service_model": agent_service.get("finalModelName"),
            })


if __name__ == "__main__":
    main()
