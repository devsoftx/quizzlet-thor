import { useEffect, useState } from "react";
import { api, type Leaderboard } from "../api";
import { LeaderboardTable } from "./LeaderboardTable";

/**
 * The public leaderboard (no sign-in needed), for the home screens.
 * `collapsible` shows it as a closed section that loads when opened.
 */
export function LeaderboardPanel({ collapsible = false }: { collapsible?: boolean }) {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!collapsible);

  useEffect(() => {
    if (!open) return;
    let current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the last failure before loading again
    setFailed(false);
    api
      .getLeaderboard()
      .then((b) => current && setBoard(b))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [open]);

  const body = failed ? (
    <p className="muted">Couldn't load the leaderboard right now.</p>
  ) : board ? (
    <LeaderboardTable board={board} />
  ) : (
    <p className="muted">Loading…</p>
  );

  if (collapsible) {
    return (
      <details className="board-panel board-panel--collapsible" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>🏆 Leaderboard</summary>
        {open && body}
      </details>
    );
  }
  return (
    <section className="board-panel" aria-labelledby="board-panel-title">
      <h2 id="board-panel-title" className="section-title">
        🏆 Leaderboard
      </h2>
      {body}
    </section>
  );
}
