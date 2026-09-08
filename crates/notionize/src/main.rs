//! The one binary: CLI + daemon. Wires the concrete adapters into `notion-core`.

use clap::{Parser, Subcommand};
use notion_api::HttpNotionClient;
use notion_core::account::{AccountState, ManagedAccount};
use notion_core::ids::{AccountId, NotionUserId};
use notion_core::pipeline::{self, Deps, InferenceRequest};
use notion_core::port::{Session, SessionStore, StateStore};
use notion_server::AppState;
use notion_store::{KeyringSessionStore, SqliteStateStore};
use std::net::SocketAddr;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "notionize", version, about = "Automate Notion AI, always on.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the daemon: REST/SSE server + web UI.
    Up {
        #[arg(long, default_value = "127.0.0.1:8787")]
        addr: SocketAddr,
        #[arg(long, default_value = "web/dist")]
        web: String,
    },
    /// List loaded accounts and their state.
    Status,
    /// Import an existing Notion session (cookie jar) as an account.
    Import {
        #[arg(long)]
        alias: String,
        #[arg(long)]
        user: String,
        #[arg(long)]
        token_v2: String,
        #[arg(long, default_value = "[]")]
        notion_users: String,
    },
    /// Run one AI request through an account (by alias).
    Run {
        #[arg(long)]
        account: String,
        prompt: String,
    },
    /// Install/uninstall the boot service (launchd on macOS, systemd on Linux).
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },
}

#[derive(Subcommand)]
enum ServiceAction {
    Install,
    Uninstall,
}

fn state_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    format!("{home}/.notionize/state.sqlite")
}

fn stores() -> Result<(SqliteStateStore, KeyringSessionStore), String> {
    let path = state_path();
    if let Some(dir) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok((SqliteStateStore::open(&path)?, KeyringSessionStore))
}

#[tokio::main]
async fn main() -> Result<(), String> {
    tracing_subscriber::fmt().init();
    match Cli::parse().cmd {
        Cmd::Up { addr, web } => up(addr, web).await,
        Cmd::Status => status().await,
        Cmd::Import { alias, user, token_v2, notion_users } => {
            import(alias, user, token_v2, notion_users).await
        }
        Cmd::Run { account, prompt } => run(account, prompt).await,
        Cmd::Service { action } => service(action),
    }
}

async fn up(addr: SocketAddr, web: String) -> Result<(), String> {
    let (state, sessions) = stores()?;
    let app = AppState {
        client: Arc::new(HttpNotionClient::new()),
        sessions: Arc::new(sessions),
        state: Arc::new(state),
    };
    notion_server::serve(app, &web, addr).await.map_err(|e| e.to_string())
}

async fn status() -> Result<(), String> {
    let (state, _) = stores()?;
    for a in state.list().await? {
        println!("{:<20} {:?} space={:?}", a.alias, a.state, a.current_space);
    }
    Ok(())
}

async fn import(alias: String, user: String, token_v2: String, notion_users: String) -> Result<(), String> {
    let (state, sessions) = stores()?;
    let session = Session {
        active_user: NotionUserId(user.clone()),
        cookie_header: format!("token_v2={token_v2}; notion_users={notion_users}"),
    };
    sessions.save(&session).await?;

    let account = ManagedAccount {
        id: AccountId::new(),
        alias,
        notion_user_id: NotionUserId(user),
        current_space: None,
        state: AccountState::Ready,
        credit: None,
        consecutive_failures: 0,
        cooldown_step: 0,
    };
    state.upsert(&account).await?;
    println!("imported account {}", account.alias);
    Ok(())
}

async fn run(alias: String, prompt: String) -> Result<(), String> {
    let (state, sessions) = stores()?;
    let client = HttpNotionClient::new();
    let mut account = state
        .list()
        .await?
        .into_iter()
        .find(|a| a.alias == alias)
        .ok_or("account not found")?;

    let deps = Deps { client: &client, sessions: &sessions, state: &state };
    let out = pipeline::run(&deps, &mut account, &InferenceRequest { prompt, model: None })
        .await
        .map_err(|e| e.to_string())?;
    println!("{}", out.text);
    Ok(())
}

fn service(action: ServiceAction) -> Result<(), String> {
    // Per-OS install scripts live in platform/. Keep the CLI thin: point the user at
    // the versioned installer for their platform.
    let os = std::env::consts::OS;
    let verb = match action {
        ServiceAction::Install => "install",
        ServiceAction::Uninstall => "uninstall",
    };
    match os {
        "macos" => println!("run: platform/macos/{verb}.sh"),
        "linux" => println!("run: platform/linux/{verb}.sh"),
        other => return Err(format!("no service integration for {other}")),
    }
    Ok(())
}
