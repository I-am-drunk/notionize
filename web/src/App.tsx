import { useEffect, useState } from "react";
import { Account, AccountState, listAccounts, run } from "./api";

// One status -> visual mapping, in one place (Framer's AccountStatusStyle lesson).
const STATUS: Record<AccountState, { tint: string; label: string }> = {
  ready: { tint: "#34c759", label: "Ready" },
  authenticating: { tint: "#0a84ff", label: "Authenticating" },
  cooling_down: { tint: "#ff9f0a", label: "Cooling down" },
  exhausted: { tint: "#ff453a", label: "Exhausted" },
  quarantined: { tint: "#bf5af2", label: "Quarantined" },
  disconnected: { tint: "#8e8e93", label: "Disconnected" },
};

type Page = "accounts" | "logs" | "test";

export function App() {
  const [page, setPage] = useState<Page>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const current = accounts.find((a) => a.id === selected) ?? null;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="pages">
          {(["accounts", "logs", "test"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {page === "accounts" && (
          <ul className="pool">
            {accounts.map((a) => (
              <li key={a.id} className={a.id === selected ? "active" : ""} onClick={() => setSelected(a.id)}>
                <span className="dot" style={{ background: STATUS[a.state].tint }} />
                {a.alias}
              </li>
            ))}
            {accounts.length === 0 && <li className="empty">No accounts</li>}
          </ul>
        )}
      </nav>
      <main className="detail">
        {page === "accounts" && <AccountDetail account={current} />}
        {page === "test" && <TestPage accounts={accounts} />}
        {page === "logs" && <p className="muted">Logs stream — coming with the daemon.</p>}
      </main>
    </div>
  );
}

function AccountDetail({ account }: { account: Account | null }) {
  if (!account) return <p className="muted">Select an account.</p>;
  const s = STATUS[account.state];
  return (
    <section className="form">
      <header>
        <div className="avatar">{account.alias[0]?.toUpperCase()}</div>
        <div>
          <h1>{account.alias}</h1>
          <span className="badge" style={{ color: s.tint, background: s.tint + "24" }}>{s.label}</span>
        </div>
      </header>
      <dl>
        <Row k="Notion user" v={account.notion_user_id} />
        <Row k="Workspace" v={account.current_space ?? "—"} />
        <Row k="Consecutive failures" v={String(account.consecutive_failures)} />
      </dl>
    </section>
  );
}

function TestPage({ accounts }: { accounts: Account[] }) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await run(account, prompt);
      setOut(r.text);
    } catch (e) {
      setOut(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form">
      <h1>Test</h1>
      <select value={account} onChange={(e) => setAccount(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.alias}</option>
        ))}
      </select>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt" rows={4} />
      <button disabled={busy || !account} onClick={go}>{busy ? "Running…" : "Run"}</button>
      {out && <pre className="out">{out}</pre>}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
