//! Credit / usage reads. Pre-flight only — the authoritative exhaustion signal is the
//! in-band `premium-feature-unavailable` handled in `inference.rs`.

use crate::transport::Transport;
use notion_core::ids::SpaceId;
use notion_core::port::Session;
use notion_core::workspace::CreditSnapshot;
use serde_json::json;

pub async fn usage(
    t: &Transport,
    session: &Session,
    space: &SpaceId,
) -> Result<CreditSnapshot, String> {
    let eligibility = t
        .post_json(
            session,
            Some(space),
            "getAIUsageEligibilityV2",
            json!({ "spaceId": space.0 }),
        )
        .await?;

    let rate = t
        .post_json(session, Some(space), "getCreditRateLimitStatus", json!({}))
        .await?;

    Ok(CreditSnapshot {
        total_balance: eligibility
            .pointer("/usage/totalCreditBalance")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        in_overage: eligibility
            .pointer("/usage/creditsInOverage")
            .and_then(|v| v.as_f64())
            .map(|n| n > 0.0)
            .unwrap_or(false),
        rate_limited: rate["status"].as_str() == Some("rate_limited"),
    })
}
