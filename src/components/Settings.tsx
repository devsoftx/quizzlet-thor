import { useState, type FormEvent } from "react";
import { api, type AccountInfo } from "../api";
import type { AccountSettings } from "../account-shared";

interface Props {
  account: AccountInfo;
  onSaved: (account: AccountInfo) => void;
  onDeleted: () => Promise<void>;
  onBack: () => void;
}

export function Settings({ account, onSaved, onDeleted, onBack }: Props) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [settings, setSettings] = useState<AccountSettings>(account.settings);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      onSaved(await api.updateMe({ displayName, settings }));
      setStatus({ kind: "ok", text: "Saved." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setStatus(null);
    try {
      await api.deleteMe();
      await onDeleted();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Couldn't delete the account." });
      setBusy(false);
    }
  }

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
        <h1>Settings</h1>
      </header>

      <form className="manage__item settings-form" onSubmit={save}>
        <label className="field">
          <span>Your name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} />
          <span className="muted field__hint">Only you see this. Kids appear by their profile nickname.</span>
        </label>
        <label className="field">
          <span>Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => setSettings({ ...settings, theme: e.target.value as AccountSettings["theme"] })}
          >
            <option value="system">Match this device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="field">
          <span>Card order</span>
          <select
            value={settings.shuffle}
            onChange={(e) => setSettings({ ...settings, shuffle: e.target.value as AccountSettings["shuffle"] })}
          >
            <option value="deck">Each deck decides</option>
            <option value="on">Always shuffle</option>
            <option value="off">Never shuffle</option>
          </select>
        </label>
        {status && (
          <p className={status.kind === "ok" ? "settings__ok" : "welcome__error"} role="status">
            {status.text}
          </p>
        )}
        <div className="profile-form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Save settings
          </button>
        </div>
      </form>

      <section className="manage__item danger-zone">
        <h2 className="section-title">Delete my account</h2>
        <p className="muted">
          Permanently deletes your account, all kid profiles and their leaderboard points. This can't be undone.
        </p>
        <label className="field">
          <span>
            Type <strong>DELETE</strong> to confirm
          </span>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || confirmText !== "DELETE"}
          onClick={deleteAccount}
        >
          Delete my account
        </button>
      </section>
    </div>
  );
}
