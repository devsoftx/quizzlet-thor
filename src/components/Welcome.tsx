import { useState, type FormEvent } from "react";

interface Props {
  notice?: string;
  onStart: (name: string) => Promise<void>;
  parentSignIn?: { label: string; onClick: () => void };
}

export function Welcome({ notice, onStart, parentSignIn }: Props) {
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
      setError(err instanceof Error ? err.message : "Couldn't start your session.");
      setBusy(false);
    }
  }

  return (
    <div className="welcome field-welcome">
      <header className="field-welcome__header">
        <p className="field-mark"><span aria-hidden="true">✳</span> Quizzlet</p>
        {parentSignIn && <button type="button" className="field-parent-link" onClick={parentSignIn.onClick}>Parent or teacher sign in</button>}
      </header>
      <div className="field-welcome__layout">
        <section className="field-welcome__intro">
          <p className="field-kicker">A little curiosity goes a long way</p>
          <h1>Big questions.<br /><em>Bright ideas.</em></h1>
          <p>Explore a world of questions, discover something new, and learn at your own pace.</p>
          <div className="field-welcome__illustration" aria-hidden="true" />
        </section>
        <section className="field-entry" aria-labelledby="entry-title">
          <span className="field-entry__number" aria-hidden="true">01 / START HERE</span>
          <h2 id="entry-title">Ready to explore?</h2>
          <p>Choose a nickname and pick a deck to begin.</p>
          {notice && <p className="welcome__notice" role="status">{notice}</p>}
          <form onSubmit={submit}>
            <label htmlFor="student-name">Your nickname</label>
            <input id="student-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="off" spellCheck={false} placeholder="For example, Nova7" aria-describedby="welcome-help" aria-invalid={error ? true : undefined} />
            <p id="welcome-help" className="field-privacy"><strong>Choose carefully:</strong> Your nickname appears on the public leaderboard when you earn points. Please don't use your real name.</p>
            {error && <p className="welcome__error" role="alert">{error}</p>}
            <button type="submit" className="btn btn--primary field-entry__submit" disabled={!name.trim() || busy}>{busy ? "Starting…" : "Start exploring"} <span aria-hidden="true">→</span></button>
          </form>
          <p className="field-entry__note">Your study session lasts 60 minutes.</p>
        </section>
      </div>
    </div>
  );
}
