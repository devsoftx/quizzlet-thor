import { useState } from "react";
import type { KidProfile } from "../account-shared";

interface Props {
  displayName: string;
  profiles: KidProfile[];
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
export function ParentHome({ displayName, profiles, notice, onPick, onManage, onDecks, onFiles, onSettings, onSignOut }: Props) {
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
        <span className="muted">Signed in as {displayName}</span>
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

      <h1 className="brand parent-home__title">
        <span aria-hidden="true">⚡</span> Who's studying?
      </h1>

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
                  aria-label={`Study as ${p.nickname}`}
                >
                  <ProfileAvatar profile={p} />
                  <span className="profile-tile__name">{busy === p.id ? "Starting…" : p.nickname}</span>
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
