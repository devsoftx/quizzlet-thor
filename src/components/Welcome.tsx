import { useState, type FormEvent } from "react";
import { POINTS_PER_CORRECT, STREAK_BONUS, STREAK_THRESHOLD } from "../points";

interface Props {
  /** Shown above the form, e.g. when a session just ended. */
  notice?: string;
  onStart: (name: string) => Promise<void>;
  /** Parent/teacher sign-in, when accounts are available. */
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
    <div className="welcome">
      <h1 className="brand welcome__brand">
        <span aria-hidden="true">⚡</span> Quizzlet
      </h1>

      {notice && (
        <p className="welcome__notice" role="status">
          {notice}
        </p>
      )}

      <form className="welcome__card" onSubmit={submit}>
        <label htmlFor="student-name" className="welcome__label">
          Welcome! What's your nickname?
        </label>
        <div className="welcome__row">
          <input
            id="student-name"
            className="welcome__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="A nickname, like StarCat or Nova7"
            aria-describedby="welcome-help"
            aria-invalid={error ? true : undefined}
          />
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
            {busy ? "Starting…" : "Start studying →"}
          </button>
        </div>
        {error && (
          <p className="welcome__error" role="alert">
            {error}
          </p>
        )}
        <p id="welcome-help" className="muted welcome__help">
          Your session lasts 60 minutes. Your nickname shows on the leaderboard, so please don't use
          your real name.
        </p>
      </form>

      {parentSignIn && (
        <section className="welcome__parents" aria-label="Parents and teachers">
          <div>
            <h2 className="section-title">Parents &amp; teachers</h2>
            <p className="muted">
              Sign in to create nickname-only profiles for your kids, keep their points, and choose who appears on
              the leaderboard.
            </p>
          </div>
          <button type="button" className="btn btn--secondary" onClick={parentSignIn.onClick}>
            {parentSignIn.label}
          </button>
        </section>
      )}

      <section className="welcome__rules" aria-label="How points work">
        <h2 className="section-title">How to earn points</h2>
        <ul>
          <li>
            <strong>+{POINTS_PER_CORRECT}</strong> for every correct answer
          </li>
          <li>
            <strong>+{STREAK_BONUS} bonus</strong> for each correct answer once you get {STREAK_THRESHOLD} in a
            row 🔥
          </li>
          <li>Points add up across every round — climb the leaderboard!</li>
        </ul>
      </section>
    </div>
  );
}
