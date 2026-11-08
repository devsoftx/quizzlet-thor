import type { Leaderboard, LeaderboardEntry } from "../api";

const MEDALS = ["🥇", "🥈", "🥉"];

function Row({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  return (
    <li className={`leaderboard__row${isYou ? " is-you" : ""}`}>
      <span className="leaderboard__rank" aria-label={`Rank ${entry.rank}`}>
        {MEDALS[entry.rank - 1] ?? entry.rank}
      </span>
      <span className="leaderboard__name">
        {entry.name}
        {isYou && <span className="tag leaderboard__you">You</span>}
      </span>
      <span className="leaderboard__points">{entry.points.toLocaleString()} pts</span>
    </li>
  );
}

export function LeaderboardTable({ board }: { board: Leaderboard }) {
  if (board.top.length === 0) {
    return <p className="muted">No points yet — be the first on the board!</p>;
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
