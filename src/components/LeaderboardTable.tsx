import type { Leaderboard, LeaderboardEntry } from "../api";
import { useI18n } from "../i18n";

const MEDALS = ["🥇", "🥈", "🥉"];

function Row({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  const { t } = useI18n();
  return (
    <li className={`leaderboard__row${isYou ? " is-you" : ""}`}>
      <span className="leaderboard__rank" aria-label={t.leaderboard.rank(entry.rank)}>
        {MEDALS[entry.rank - 1] ?? entry.rank}
      </span>
      <span className="leaderboard__name">
        {entry.emoji && (
          <span className="leaderboard__emoji" title={t.leaderboard.kidProfile} aria-hidden="true">
            {entry.emoji}
          </span>
        )}
        {entry.name}
        {isYou && <span className="tag leaderboard__you">{t.leaderboard.you}</span>}
      </span>
      <span className="leaderboard__points">{t.common.pts(entry.points)}</span>
    </li>
  );
}

export function LeaderboardTable({ board }: { board: Leaderboard }) {
  const { t } = useI18n();
  if (board.top.length === 0) {
    return <p className="muted">{t.leaderboard.empty}</p>;
  }
  const you = board.you;
  const youInTop = you !== null && board.top.some((e) => e.rank === you.rank);

  return (
    <ol className="leaderboard">
      {board.top.map((entry) => (
        <Row key={entry.rank} entry={entry} isYou={entry.rank === you?.rank} />
      ))}
      {you && !youInTop && (
        <>
          <li className="leaderboard__gap" aria-hidden="true">
            ⋯
          </li>
          <Row entry={you} isYou />
        </>
      )}
    </ol>
  );
}
