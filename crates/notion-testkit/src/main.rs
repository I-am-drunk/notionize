//! Deterministic verifier. Named groups, each attributable on failure, headless.
//! Run all: `cargo run -p notion-testkit --bin notion-verify`
//! Narrow:  `... -- --only exhaustion`

use notion_core::pipeline::{self, Deps, InferenceOutcome, InferenceRequest, InferenceResult};
use notion_testkit::{test_account, MemSessionStore, MemStateStore, MockNotion};

#[tokio::main]
async fn main() {
    let only = std::env::args()
        .skip_while(|a| a != "--only")
        .nth(1)
        .unwrap_or_default();

    let mut failed = 0;
    for (name, result) in run_groups().await {
        if !only.is_empty() && !name.contains(&only) {
            continue;
        }
        match result {
            Ok(()) => println!("ok   {name}"),
            Err(e) => {
                failed += 1;
                println!("FAIL {name}: {e}");
            }
        }
    }
    if failed > 0 {
        eprintln!("\n{failed} group(s) failed");
        std::process::exit(1);
    }
    println!("\nall groups passed");
}

async fn run_groups() -> Vec<(&'static str, Result<(), String>)> {
    vec![
        ("exhaustion_fails_closed_and_rotates", exhaustion_rotates().await),
        ("double_exhaustion_errors", double_exhaustion().await),
        ("rotation_picks_least_failed", rotation_pick()),
    ]
}

async fn exhaustion_rotates() -> Result<(), String> {
    let client = MockNotion::new(vec![
        InferenceResult::Exhausted { reason: "premium-feature-unavailable".into() },
        InferenceResult::Completed(InferenceOutcome { text: "hi".into(), usage: Default::default() }),
    ]);
    let sessions = MemSessionStore;
    let state = MemStateStore::default();
    let mut account = test_account();

    let deps = Deps { client: &client, sessions: &sessions, state: &state };
    let out = pipeline::run(&deps, &mut account, &req("hello")).await.map_err(|e| e.to_string())?;
    if out.text != "hi" {
        return Err(format!("unexpected text: {}", out.text));
    }
    if *client.created_spaces.lock().unwrap() != 1 {
        return Err("expected exactly one new workspace".into());
    }
    Ok(())
}

async fn double_exhaustion() -> Result<(), String> {
    let client = MockNotion::new(vec![
        InferenceResult::Exhausted { reason: "x".into() },
        InferenceResult::Exhausted { reason: "x".into() },
    ]);
    let sessions = MemSessionStore;
    let state = MemStateStore::default();
    let mut account = test_account();
    let deps = Deps { client: &client, sessions: &sessions, state: &state };
    match pipeline::run(&deps, &mut account, &req("hello")).await {
        Err(_) => Ok(()),
        Ok(_) => Err("expected error after double exhaustion".into()),
    }
}

fn rotation_pick() -> Result<(), String> {
    let mut a = test_account();
    a.consecutive_failures = 5;
    let mut b = test_account();
    b.consecutive_failures = 1;
    let pool = vec![a, b.clone()];
    match notion_core::rotation::pick(&pool) {
        Some(p) if p.consecutive_failures == 1 => Ok(()),
        _ => Err("expected least-failed account".into()),
    }
}

fn req(prompt: &str) -> InferenceRequest {
    InferenceRequest { prompt: prompt.into(), model: None }
}
