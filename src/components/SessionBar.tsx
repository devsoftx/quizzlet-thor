import { useEffect, useState } from "react";
import type { SessionInfo } from "../api";

interface Props {
  session: SessionInfo;
  onEnd: () => void;
}

function timeLeft(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.round((deadline - now) / 1000));
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min left`;
}

export function SessionBar({ session, onEnd }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const urgent = session.deadline - now < 5 * 60 * 1000;

  return (
    <div className="session-bar" aria-label="Your session">
      <span className="session-bar__name">👤 {session.name}</span>
      <span className="session-bar__points" title="Points earned this session">
        ⭐ {session.points} pts
      </span>
      <span className={`session-bar__time${urgent ? " is-urgent" : ""}`}>
        ⏱ {timeLeft(session.deadline, now)}
      </span>
      <button type="button" className="btn btn--ghost session-bar__end" onClick={onEnd}>
        {session.profileId ? "Switch profile" : "End session"}
      </button>
    </div>
  );
}
