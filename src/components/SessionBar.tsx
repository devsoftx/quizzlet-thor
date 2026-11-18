import { useEffect, useState } from "react";
import type { SessionInfo } from "../api";
import { useI18n, type Messages } from "../i18n";

interface Props {
  session: SessionInfo;
  onEnd: () => void;
  /** Defaults to "Switch profile" for kid profiles and "End session" for guests. */
  endLabel?: string;
}

function timeLeft(deadline: number, now: number, t: Messages): string {
  const seconds = Math.max(0, Math.round((deadline - now) / 1000));
  if (seconds < 60) return t.sessionBar.lessThanAMinute;
  return t.sessionBar.minutesLeft(Math.ceil(seconds / 60));
}

export function SessionBar({ session, onEnd, endLabel }: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const urgent = session.deadline - now < 5 * 60 * 1000;

  return (
    <div className="session-bar" aria-label={t.sessionBar.label}>
      <span className="session-bar__name">👤 {session.name}</span>
      <span className="session-bar__points" title={t.sessionBar.pointsTitle}>
        ⭐ {t.common.pts(session.points)}
      </span>
      <span className={`session-bar__time${urgent ? " is-urgent" : ""}`}>
        ⏱ {timeLeft(session.deadline, now, t)}
      </span>
      <button type="button" className="btn btn--ghost session-bar__end" onClick={onEnd}>
        {endLabel ?? (session.profileId ? t.sessionBar.switchProfile : t.sessionBar.end)}
      </button>
    </div>
  );
}
