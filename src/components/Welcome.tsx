import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { LeaderboardPanel } from "./LeaderboardPanel";

interface Props {
  notice?: string;
  onStart: (name: string) => Promise<void>;
  parentSignIn?: { label: string; onClick: () => void };
}

export function Welcome({ notice, onStart, parentSignIn }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.welcome.startFailed);
      setBusy(false);
    }
  }

  return (
    <div className="welcome field-welcome">
      <header className="field-welcome__header">
        <p className="field-mark"><span aria-hidden="true">✳</span> Quizzlet</p>
        {parentSignIn && <button type="button" className="field-parent-link" onClick={parentSignIn.onClick}>{t.common.parentSignIn}</button>}
      </header>
      <div className="field-welcome__layout">
        <section className="field-welcome__intro">
          <p className="field-kicker">{t.welcome.kicker}</p>
          <h1>{t.welcome.titleLine1}<br /><em>{t.welcome.titleLine2}</em></h1>
          <p>{t.welcome.intro}</p>
          <div className="field-welcome__illustration" aria-hidden="true" />
        </section>
        <section className="field-entry" aria-labelledby="entry-title">
          <span className="field-entry__number" aria-hidden="true">{t.welcome.step}</span>
          <h2 id="entry-title">{t.welcome.entryTitle}</h2>
          <p>{t.welcome.entryText}</p>
          {notice && <p className="welcome__notice" role="status">{notice}</p>}
          <form onSubmit={submit}>
            <label htmlFor="student-name">{t.welcome.nickname}</label>
            <input id="student-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="off" spellCheck={false} placeholder={t.welcome.nicknamePlaceholder} aria-describedby="welcome-help" aria-invalid={error ? true : undefined} />
            <p id="welcome-help" className="field-privacy"><strong>{t.welcome.privacyLead}</strong> {t.welcome.privacy}</p>
            {error && <p className="welcome__error" role="alert">{error}</p>}
            <button type="submit" className="btn btn--primary field-entry__submit" disabled={!name.trim() || busy}>{busy ? t.welcome.starting : t.welcome.start} <span aria-hidden="true">→</span></button>
          </form>
          <p className="field-entry__note">{t.welcome.sessionLength}</p>
        </section>
      </div>
      {/* The public leaderboard, no sign-in needed. */}
      <LeaderboardPanel />
    </div>
  );
}
