import { useState, type FormEvent } from "react";
import { api, type AccountInfo } from "../api";
import type { AccountSettings } from "../account-shared";
import { useI18n } from "../i18n";
import { rich } from "../i18n/rich";

interface Props {
  account: AccountInfo;
  onSaved: (account: AccountInfo) => void;
  onDeleted: () => Promise<void>;
  onBack: () => void;
}

export function Settings({ account, onSaved, onDeleted, onBack }: Props) {
  const { t } = useI18n();
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
      setStatus({ kind: "ok", text: t.settings.saved });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t.settings.saveFailed });
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
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t.settings.deleteFailed });
      setBusy(false);
    }
  }

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          {t.common.back}
        </button>
        <h1>{t.settings.title}</h1>
      </header>

      <form className="manage__item settings-form" onSubmit={save}>
        <label className="field">
          <span>{t.settings.yourName}</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} />
          <span className="muted field__hint">{t.settings.yourNameHint}</span>
        </label>
        <label className="field">
          <span>{t.settings.theme}</span>
          <select
            value={settings.theme}
            onChange={(e) => setSettings({ ...settings, theme: e.target.value as AccountSettings["theme"] })}
          >
            <option value="system">{t.settings.themes.system}</option>
            <option value="light">{t.settings.themes.light}</option>
            <option value="dark">{t.settings.themes.dark}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.settings.cardOrder}</span>
          <select
            value={settings.shuffle}
            onChange={(e) => setSettings({ ...settings, shuffle: e.target.value as AccountSettings["shuffle"] })}
          >
            <option value="deck">{t.settings.cardOrders.deck}</option>
            <option value="on">{t.settings.cardOrders.on}</option>
            <option value="off">{t.settings.cardOrders.off}</option>
          </select>
        </label>
        {status && (
          <p className={status.kind === "ok" ? "settings__ok" : "welcome__error"} role="status">
            {status.text}
          </p>
        )}
        <div className="profile-form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t.settings.saveSettings}
          </button>
        </div>
      </form>

      <section className="manage__item danger-zone">
        <h2 className="section-title">{t.settings.deleteTitle}</h2>
        <p className="muted">
          {t.settings.deleteText}
        </p>
        <label className="field">
          <span>
            {rich(t.settings.typeToConfirm, { word: <strong>{t.settings.deleteWord}</strong> })}
          </span>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || confirmText.trim() !== t.settings.deleteWord}
          onClick={deleteAccount}
        >
          {t.settings.deleteButton}
        </button>
      </section>
    </div>
  );
}
