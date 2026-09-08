//! REST/SSE server. Dumb by design: it renders state and forwards typed calls into
//! `notion-core`. No account logic lives here. Also serves the built web UI.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use notion_core::account::ManagedAccount;
use notion_core::ids::AccountId;
use notion_core::pipeline::{self, Deps, InferenceOutcome, InferenceRequest};
use notion_core::port::{NotionClient, SessionStore, StateStore};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::ServeDir;

#[derive(Clone)]
pub struct AppState {
    pub client: Arc<dyn NotionClient>,
    pub sessions: Arc<dyn SessionStore>,
    pub state: Arc<dyn StateStore>,
}

/// Build the router: REST under `/api`, everything else served from `web_dir`.
pub fn router(state: AppState, web_dir: &str) -> Router {
    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/accounts", get(accounts))
        .route("/run", post(run))
        .with_state(state);

    Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(web_dir))
}

pub async fn serve(state: AppState, web_dir: &str, addr: SocketAddr) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "notionize listening");
    axum::serve(listener, router(state, web_dir)).await
}

async fn accounts(State(s): State<AppState>) -> Result<Json<Vec<ManagedAccount>>, ApiError> {
    Ok(Json(s.state.list().await.map_err(ApiError)?))
}

#[derive(Deserialize)]
struct RunBody {
    account_id: AccountId,
    prompt: String,
    #[serde(default)]
    model: Option<String>,
}

async fn run(
    State(s): State<AppState>,
    Json(body): Json<RunBody>,
) -> Result<Json<InferenceOutcome>, ApiError> {
    let mut account = s
        .state
        .get(body.account_id)
        .await
        .map_err(ApiError)?
        .ok_or_else(|| ApiError("account not found".into()))?;

    let deps = Deps {
        client: s.client.as_ref(),
        sessions: s.sessions.as_ref(),
        state: s.state.as_ref(),
    };
    let req = InferenceRequest {
        prompt: body.prompt,
        model: body.model,
    };
    let outcome = pipeline::run(&deps, &mut account, &req)
        .await
        .map_err(|e| ApiError(e.to_string()))?;
    Ok(Json(outcome))
}

struct ApiError(String);

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}
