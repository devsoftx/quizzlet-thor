import { useEffect, useState } from "react";
import type { KidCard } from "../account-shared";
import { api, type KidHomeInfo } from "../api";
import { getLanguage, messagesFor, useI18n } from "../i18n";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { ProfileAvatar } from "./ParentHome";

/** Opening an invitation link: confirm, then link this device to the kid's profile. */
export function JoinInvite({
  token,
  onJoined,
  onClose,
}: {
  token: string;
  onJoined: (kid: KidHomeInfo) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<KidCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(messagesFor(getLanguage()).kid.linkIncomplete);
      return;
    }
    api
      .peekInvite(token)
      .then((r) => setProfile(r.profile))
      .catch((err: Error) => setError(err.message));
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.joinInvite(token);
      const kid = await api.kidHome();
      if (!kid) throw new Error(t.kid.linkRetry);
      onJoined(kid);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.kid.linkFailed);
      setBusy(false);
    }
  }

  return (
    <div className="kid-screen">
      <h1 className="brand">Quizzlet</h1>
      {error ? (
        <>
          <p className="welcome__error" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t.common.ok}
          </button>
        </>
      ) : !profile ? (
          <p className="muted loading" role="status">{t.kid.checking}</p>
      ) : (
        <>
          <ProfileAvatar profile={profile} size={96} />
          <h2 className="kid-screen__title">{t.kid.studyAsQuestion(profile.nickname)}</h2>
          <p className="muted kid-screen__text">
            {t.kid.linkExplain(profile.nickname)}
          </p>
          <div className="kid-screen__actions">
            <button type="button" className="btn btn--primary" onClick={join} disabled={busy}>
              {busy ? t.kid.linking : t.kid.useDevice(profile.nickname)}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              {t.kid.notNow}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** A kid's own linked device, between sessions. */
export function KidHome({
  profile,
  totalPoints,
  notice,
  onStart,
  onUnlink,
  onParentSignIn,
}: {
  profile: KidCard;
  totalPoints: number;
  notice?: string;
  onStart: () => Promise<void>;
  onUnlink: () => Promise<void>;
  onParentSignIn?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kid-screen">
      <ProfileAvatar profile={profile} size={96} />
      <h1 className="kid-screen__title">{t.kid.welcomeBack(profile.nickname)}</h1>
      <p className="kid-screen__points" aria-label={t.kid.pointsSoFar(totalPoints)}>
        ⭐ {t.kid.pointsSoFar(totalPoints)}
      </p>
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
      <p className="muted kid-screen__text">{t.kid.ready}</p>
      <button type="button" className="btn btn--primary kid-screen__start" onClick={() => run(onStart)} disabled={busy}>
        {t.kid.explore}
      </button>
      <button
        type="button"
        className="btn btn--ghost kid-screen__unlink"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t.kid.confirmUnlink(profile.nickname))) {
            run(onUnlink);
          }
        }}
      >
        {t.kid.notMe(profile.nickname)}
      </button>
      {onParentSignIn && <button type="button" className="btn btn--ghost" onClick={onParentSignIn}>{t.common.parentSignIn}</button>}
      <LeaderboardPanel />
    </div>
  );
}
