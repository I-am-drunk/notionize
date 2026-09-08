// Thin typed client. Same-origin only — the daemon serves this bundle and the API.

export type AccountState =
  | "disconnected"
  | "authenticating"
  | "ready"
  | "cooling_down"
  | "exhausted"
  | "quarantined";

export interface Account {
  id: string;
  alias: string;
  notion_user_id: string;
  current_space: string | null;
  state: AccountState;
  consecutive_failures: number;
}

export interface RunOutcome {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function listAccounts(): Promise<Account[]> {
  const r = await fetch("/api/accounts");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function run(accountId: string, prompt: string): Promise<RunOutcome> {
  const r = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: accountId, prompt }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
