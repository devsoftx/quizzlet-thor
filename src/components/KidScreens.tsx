import { useEffect, useState } from "react";
import type { KidCard } from "../account-shared";
import { api, type KidHomeInfo } from "../api";
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
  const [profile, setProfile] = useState<KidCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a link with no token has nothing to load
      setError("This link isn't complete. Ask your parent to send it again.");
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
      if (!kid) throw new Error("This device couldn't be linked. Please try the link again.");
      onJoined(kid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This device couldn't be linked.");
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
            OK
          </button>
        </>
      ) : !profile ? (
          <p className="muted loading" role="status">Checking your link…</p>
      ) : (
        <>
          <ProfileAvatar profile={profile} size={96} />
          <h2 className="kid-screen__title">Study as {profile.nickname}?</h2>
          <p className="muted kid-screen__text">
            This device will be linked to {profile.nickname}'s profile, so you can study here and earn points. No
            email or password needed. Your parent can remove this device anytime.
          </p>
          <div className="kid-screen__actions">
            <button type="button" className="btn btn--primary" onClick={join} disabled={busy}>
              {busy ? "Linking…" : `Use this device as ${profile.nickname}`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Not now
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kid-screen">
      <ProfileAvatar profile={profile} size={96} />
      <h1 className="kid-screen__title">Welcome back, {profile.nickname}.</h1>
      <p className="kid-screen__points" aria-label={`${totalPoints} points so far`}>
        ⭐ {totalPoints.toLocaleString()} points so far
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
      <p className="muted kid-screen__text">Ready for another discovery? Your study session lasts 60 minutes.</p>
      <button type="button" className="btn btn--primary kid-screen__start" onClick={() => run(onStart)} disabled={busy}>
        Explore decks →
      </button>
      <button
        type="button"
        className="btn btn--ghost kid-screen__unlink"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Remove this device from ${profile.nickname}'s profile? You'll need a new link from your parent.`)) {
            void run(onUnlink);
          }
        }}
      >
        Not {profile.nickname}? Remove this device
      </button>
      {onParentSignIn && <button type="button" className="btn btn--ghost" onClick={onParentSignIn}>Parent or teacher sign in</button>}
      <LeaderboardPanel />
    </div>
  );
}
