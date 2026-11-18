import { useState } from "react";
import type { KidProfile } from "../account-shared";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onPick(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.parentHome.startFailed);
      setBusy(null);
    }
  }

  return (
    <div className="parent-home">
      <header className="parent-home__bar">
        <span><strong className="field-mark">Quizzlet</strong><br /><span className="muted">{t.parentHome.workspace(displayName)}</span></span>
        <span className="parent-home__actions">
          <button type="button" className="btn btn--ghost" onClick={onDecks}>
            {t.parentHome.myDecks}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onFiles}>
            {t.parentHome.myFiles}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSettings}>
            {t.parentHome.settings}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onSignOut}>
            {t.app.signOut}
          </button>
        </span>
      </header>

      <div className="parent-home__intro"><h1 className="parent-home__title">{t.parentHome.title}</h1><p className="muted">{t.parentHome.intro}</p></div>

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
          <p>{t.parentHome.noProfiles}</p>
          <p className="muted">{t.parentHome.noProfilesHint}</p>
          <button type="button" className="btn btn--primary" onClick={onManage}>
            {t.parentHome.addProfile}
          </button>
        </div>
      ) : (
        <>
          <ul className="profile-grid">
            {profiles.map((p) => (
              <li key={p.id}>
                {/* The visible text is the button's name (plus "Study as" for screen readers),
                    so voice control users can say what they see. */}
                <button type="button" className="profile-tile" onClick={() => pick(p.id)} disabled={busy !== null}>
                  <ProfileAvatar profile={p} />
                  <span className="profile-tile__name">
                    <span className="visually-hidden">{t.parentHome.studyAs}</span>
                    {busy === p.id ? t.parentHome.starting : p.nickname}
                  </span>
                  <span className="profile-tile__points">
                    <span aria-hidden="true">⭐ </span>
                    {t.common.pts(points[p.id] ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="parent-home__manage">
            <button type="button" className="btn btn--secondary" onClick={onManage}>
              {t.parentHome.manage}
            </button>
          </p>
        </>
      )}
    </div>
  );
}
