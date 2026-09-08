//! `runInferenceTranscript` — the central route. Request is a JSON envelope; response
//! is Notion NDJSON (not SSE): `patch-start -> patch* -> record-map -> patch-sync`.
//!
//! Two rules encoded here, reconfirmed against `../fixtures/inference-*.ndjson` (real
//! sanitized captures, see `reference/tools/notion-anthropic-sse/adapter.py` for the
//! reference implementation this was checked against):
//!   - `patch-sync.data.s` is an ARRAY of transcript steps, not a string — it is the
//!     authoritative final state, so the patch stream never needs to be replayed. The
//!     answer lives in the last `agent-inference` step: text at `value[0].content`,
//!     token usage at `inputTokens`/`outputTokens` on that same step.
//!   - a credit-exhausted run still returns HTTP 200, truncated to
//!     `patch-start -> record-map` with `premium-feature-unavailable` and no
//!     `patch-sync`. Fail closed → `InferenceResult::Exhausted`.

use crate::transport::Transport;
use notion_core::ids::SpaceId;
use notion_core::pipeline::{InferenceOutcome, InferenceRequest, InferenceResult, Usage};
use notion_core::port::Session;
use serde_json::{json, Value};

const EXHAUSTED_DISCRIMINATOR: &str = "premium-feature-unavailable";

pub async fn run(
    t: &Transport,
    session: &Session,
    space: &SpaceId,
    req: &InferenceRequest,
) -> Result<InferenceResult, String> {
    let body = build_envelope(space, req);
    let text = t.post(session, Some(space), "runInferenceTranscript", body).await?;
    parse_ndjson(&text)
}

/// The request envelope. Field set is from the archive; the fragile bits (model
/// codename, config flags) are the ones most likely to drift.
fn build_envelope(space: &SpaceId, req: &InferenceRequest) -> Value {
    let mut config = json!({ "useWebSearch": false });
    if let Some(model) = &req.model {
        config["model"] = json!(model);
    }
    json!({
        "asPatchResponse": true,
        "patchResponseVersion": 2,
        "createThread": true,
        "generateTitle": false,
        "isPartialTranscript": false,
        "saveAllThreadOperations": true,
        "setUnreadState": true,
        "createdSource": "ai_module",
        "threadType": "personal_agent",
        "spaceId": space.0,
        "transcript": [
            { "type": "config", "value": config },
            { "type": "user", "value": [[ req.prompt ]] },
        ],
    })
}

/// Parse the NDJSON stream into a terminal result. Line shapes are undocumented, so
/// this is deliberately defensive; verify against a fresh capture when it drifts
/// (see the `notion-endpoint-repair` skill).
fn parse_ndjson(text: &str) -> Result<InferenceResult, String> {
    let mut final_state: Option<Value> = None;

    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        // Fail closed on the exhaustion discriminator regardless of where it appears.
        if line.contains(EXHAUSTED_DISCRIMINATOR) {
            return Ok(InferenceResult::Exhausted {
                reason: EXHAUSTED_DISCRIMINATOR.to_string(),
            });
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v["type"].as_str() == Some("patch-sync") {
            final_state = v.pointer("/data/s").cloned();
        }
    }

    let Some(Value::Array(state)) = final_state else {
        // No terminal patch and no discriminator: treat as exhausted rather than an
        // empty success — never hand back a blank completion.
        return Ok(InferenceResult::Exhausted {
            reason: "stream ended without patch-sync".to_string(),
        });
    };

    // The turn's answer is the most recently appended `agent-inference` step; a
    // continued thread's state array also carries earlier turns' steps.
    let inference = state
        .iter()
        .rev()
        .find(|step| step["type"] == "agent-inference")
        .ok_or("patch-sync state has no agent-inference step")?;

    let text = inference
        .pointer("/value/0/content")
        .and_then(Value::as_str)
        .ok_or("agent-inference step has no text content")?
        .to_string();

    Ok(InferenceResult::Completed(InferenceOutcome {
        text,
        usage: Usage {
            input_tokens: inference["inputTokens"].as_u64().unwrap_or(0),
            output_tokens: inference["outputTokens"].as_u64().unwrap_or(0),
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_real_successful_capture() {
        let ndjson = include_str!("../fixtures/inference-success.ndjson");
        match parse_ndjson(ndjson).unwrap() {
            InferenceResult::Completed(out) => {
                assert_eq!(out.text, "NOTION_CAPTURE_OK");
                assert_eq!(out.usage.input_tokens, 22560);
                assert_eq!(out.usage.output_tokens, 8);
            }
            other => panic!("expected Completed, got {other:?}"),
        }
    }

    #[test]
    fn fails_closed_on_a_real_quota_exhausted_capture() {
        let ndjson = include_str!("../fixtures/inference-exhausted.ndjson");
        match parse_ndjson(ndjson).unwrap() {
            InferenceResult::Exhausted { reason } => assert_eq!(reason, EXHAUSTED_DISCRIMINATOR),
            other => panic!("expected Exhausted, got {other:?}"),
        }
    }
}
