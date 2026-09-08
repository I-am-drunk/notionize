//! Test doubles + fixtures so behavior can be verified offline and deterministically,
//! never against live Notion. Grow the fixture corpus as real captures arrive.

use async_trait::async_trait;
use notion_core::account::ManagedAccount;
use notion_core::ids::{AccountId, NotionUserId, SpaceId};
use notion_core::pipeline::{InferenceOutcome, InferenceRequest, InferenceResult, Usage};
use notion_core::port::{
    LoginOptions, NotionClient, Session, SessionStore, SpaceSpec, StateStore,
};
use notion_core::workspace::CreditSnapshot;
use std::sync::Mutex;

/// A scripted Notion client. Each `run_inference` pops the next queued result, so a
/// test can say "exhausted first, then completed after rotation".
pub struct MockNotion {
    pub results: Mutex<Vec<InferenceResult>>,
    pub can_create: bool,
    pub created_spaces: Mutex<u32>,
}

impl MockNotion {
    pub fn new(results: Vec<InferenceResult>) -> Self {
        Self {
            results: Mutex::new(results),
            can_create: true,
            created_spaces: Mutex::new(0),
        }
    }
}

#[async_trait]
impl NotionClient for MockNotion {
    async fn login_options(&self, _email: &str) -> Result<LoginOptions, String> {
        Ok(LoginOptions {
            has_account: true,
            password_sign_in: true,
            login_options_token: None,
        })
    }
    async fn complete_login(&self, _e: &str, _s: &str) -> Result<Session, String> {
        Ok(session())
    }
    async fn run_inference(
        &self,
        _s: &Session,
        _space: &SpaceId,
        _r: &InferenceRequest,
    ) -> Result<InferenceResult, String> {
        let mut q = self.results.lock().unwrap();
        Ok(if q.is_empty() {
            InferenceResult::Completed(InferenceOutcome {
                text: "ok".into(),
                usage: Usage::default(),
            })
        } else {
            q.remove(0)
        })
    }
    async fn usage(&self, _s: &Session, _space: &SpaceId) -> Result<CreditSnapshot, String> {
        Ok(CreditSnapshot { total_balance: 10.0, in_overage: false, rate_limited: false })
    }
    async fn can_create_workspace(&self, _s: &Session) -> Result<bool, String> {
        Ok(self.can_create)
    }
    async fn create_space(&self, _s: &Session, _spec: &SpaceSpec) -> Result<SpaceId, String> {
        let mut n = self.created_spaces.lock().unwrap();
        *n += 1;
        Ok(SpaceId(format!("space-{n}")))
    }
}

pub struct MemSessionStore;
#[async_trait]
impl SessionStore for MemSessionStore {
    async fn load(&self, _u: &NotionUserId) -> Result<Option<Session>, String> {
        Ok(Some(session()))
    }
    async fn save(&self, _s: &Session) -> Result<(), String> {
        Ok(())
    }
    async fn delete(&self, _u: &NotionUserId) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Default)]
pub struct MemStateStore {
    pub accounts: Mutex<Vec<ManagedAccount>>,
}
#[async_trait]
impl StateStore for MemStateStore {
    async fn get(&self, id: AccountId) -> Result<Option<ManagedAccount>, String> {
        Ok(self.accounts.lock().unwrap().iter().find(|a| a.id == id).cloned())
    }
    async fn list(&self) -> Result<Vec<ManagedAccount>, String> {
        Ok(self.accounts.lock().unwrap().clone())
    }
    async fn upsert(&self, account: &ManagedAccount) -> Result<(), String> {
        let mut v = self.accounts.lock().unwrap();
        if let Some(slot) = v.iter_mut().find(|a| a.id == account.id) {
            *slot = account.clone();
        } else {
            v.push(account.clone());
        }
        Ok(())
    }
}

pub fn session() -> Session {
    Session {
        active_user: NotionUserId("user-1".into()),
        cookie_header: "token_v2=x; notion_users=[]".into(),
    }
}

pub fn test_account() -> ManagedAccount {
    ManagedAccount {
        id: AccountId::new(),
        alias: "test".into(),
        notion_user_id: NotionUserId("user-1".into()),
        current_space: Some(SpaceId("space-0".into())),
        state: notion_core::account::AccountState::Ready,
        credit: None,
        consecutive_failures: 0,
        cooldown_step: 0,
    }
}
