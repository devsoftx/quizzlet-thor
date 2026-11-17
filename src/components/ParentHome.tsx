import { useState } from "react";
import type { KidProfile } from "../account-shared";

interface Props {
  displayName: string;
  profiles: KidProfile[];
  /** Each kid's all-time points, by profile id. */
  points: Record<string, number>;
  notice?: string;
  onPick: (profileId: string) => Promise<void>;
  onManage: () => void;
  onDecks: () => void;
  onFiles: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}

export function ProfileAvatar({ profile, size = 64 }: { profile: Pick<KidProfile, "emoji" | "color">; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: profile.color, width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden="true"
    >
      {profile.emoji}
    </span>
  );
}

/** A signed-in parent's home: pick which kid is studying. */
export function ParentHome({
  displayName,
  profiles,
  points,
  notice,
  onPick,
  onManage,
  onDecks,
  onFiles,
  onSettings,
  onSignOut,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onPick(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the session.");
      setBusy(null);
    }
  }

  return (
    <div className="parent-home">
      <header className="parent-home__bar">
        <span><strong className="field-mark">Quizzlet</strong><br /><span className="muted">Parent &amp; teacher workspace · {displayName}</span></span>
        <span className="parent-home__actions">
          <button type="button" className="btn btn--ghost" onClick={onDecks}>
            My decks
          </button>
          <button type="button" className="btn btn--ghost" onClick={onFiles}>
            My files
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSettings}>
            Settings
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSignOut}>
            Sign out
          </button>
        </span>
      </header>

      <div className="parent-home__intro"><h1 className="parent-home__title">Who's exploring today?</h1><p className="muted">Choose a learner to begin, or manage your family's study space.</p></div>

      {notice && (
        <p className="welcome__notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}

      {profiles.length === 0 ? (
        <div className="empty">
          <p>No kid profiles yet.</p>
          <p className="muted">Create a nickname-only profile for each child who studies with Quizzlet.</p>
          <button type="button" className="btn btn--primary" onClick={onManage}>
            Add a profile
          </button>
        </div>
      ) : (
        <>
          <ul className="profile-grid">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="profile-tile"
                  onClick={() => pick(p.id)}
                  disabled={busy !== null}
                  aria-label={`Study as ${p.nickname}, ${points[p.id] ?? 0} points`}
                >
                  <ProfileAvatar profile={p} />
                  <span className="profile-tile__name">{busy === p.id ? "Starting…" : p.nickname}</span>
                  <span className="profile-tile__points">⭐ {(points[p.id] ?? 0).toLocaleString()} pts</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="parent-home__manage">
            <button type="button" className="btn btn--secondary" onClick={onManage}>
              Manage profiles
            </button>
          </p>
        </>
      )}
    </div>
  );
}
