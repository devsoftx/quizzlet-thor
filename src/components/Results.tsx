import type { CSSProperties } from "react";
import type { SaveState } from "../App";
import type { Deck } from "../deck";
import { LeaderboardTable } from "./LeaderboardTable";
import type { AnswerRecord } from "./Quiz";

interface Props {
  deck: Deck;
  results: AnswerRecord[];
  isRetry: boolean;
  newBest: boolean;
  save: SaveState;
  onRetrySave: () => void;
  onNewSession: () => void;
  onRetryMissed: () => void;
  onRestart: () => void;
  onExit: () => void;
}

function message(percent: number): string {
  if (percent === 100) return "Flawless. Worthy of Mjölnir.";
  if (percent >= 80) return "Great work!";
  if (percent >= 50) return "Getting there — keep practicing.";
  return "Tough round. Try the missed cards again.";
}

function PointsAndLeaderboard({
  save,
  roundPoints,
  onRetrySave,
  onNewSession,
}: {
  save: SaveState;
  roundPoints: number;
  onRetrySave: () => void;
  onNewSession: () => void;
}) {
  switch (save.status) {
    case "saving":
      return (
        <p className="muted" role="status">
          Saving your +{roundPoints} points…
        </p>
      );
    case "expired":
      return (
        <div className="save-problem" role="alert">
          <p>Your 60-minute session ended before this round finished, so these points weren't saved.</p>
          <button type="button" className="btn btn--primary" onClick={onNewSession}>
            Start a new session
          </button>
        </div>
      );
    case "error":
      return (
        <div className="save-problem" role="alert">
          <p>Couldn't save your points: {save.message}</p>
          <button type="button" className="btn btn--secondary" onClick={onRetrySave}>
            Try again
          </button>
        </div>
      );
    case "saved": {
      const { result } = save;
      return (
        <>
          <div className="points-summary">
            <div className="points-summary__earned">
              <span className="points-summary__big">+{result.pointsEarned}</span>
              <span className="muted">points this round</span>
            </div>
            <div className="points-summary__totals">
              <span>
                This session <strong>{result.sessionPoints.toLocaleString()}</strong>
              </span>
              <span>
                All-time total <strong>{result.totalPoints.toLocaleString()}</strong>
              </span>
            </div>
          </div>
          <h2 className="section-title">🏆 Leaderboard</h2>
          <LeaderboardTable board={result.leaderboard} />
        </>
      );
    }
  }
}

export function Results({
  deck,
  results,
  isRetry,
  newBest,
  save,
  onRetrySave,
  onNewSession,
  onRetryMissed,
  onRestart,
  onExit,
}: Props) {
  const correct = results.filter((r) => r.correct).length;
  const missed = results.length - correct;
  const percent = Math.round((correct / results.length) * 100);
  const roundPoints = results.reduce((sum, r) => sum + r.points, 0);

  return (
    <div className="results">
      <header className="results__summary">
        <p className="eyebrow">{isRetry ? `${deck.title} · missed cards` : deck.title}</p>
        <div
          className="score-ring"
          style={{ "--pct": `${percent}` } as CSSProperties}
          role="img"
          aria-label={`${percent}% correct`}
        >
          <span>{percent}%</span>
        </div>
        <h1>
          {correct} of {results.length} correct
        </h1>
        <p className="muted">
          {message(percent)}
          {newBest && <span className="tag tag--best">New best!</span>}
        </p>
        <div className="results__actions">
          {missed > 0 && (
            <button type="button" className="btn btn--primary" onClick={onRetryMissed}>
              Retry missed ({missed})
            </button>
          )}
          <button
            type="button"
            className={`btn ${missed > 0 ? "btn--secondary" : "btn--primary"}`}
            onClick={onRestart}
          >
            Restart deck
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            All decks
          </button>
        </div>
      </header>

      <section className="results__board" aria-live="polite">
        <PointsAndLeaderboard
          save={save}
          roundPoints={roundPoints}
          onRetrySave={onRetrySave}
          onNewSession={onNewSession}
        />
      </section>

      <section>
        <h2 className="section-title">Review</h2>
        <ol className="review">
          {results.map((r, i) => (
            <li key={i} className={`review__item ${r.correct ? "is-correct" : "is-wrong"}`}>
              <span className="review__mark" aria-label={r.correct ? "Correct" : "Wrong"}>
                {r.correct ? "✓" : "✗"}
              </span>
              <div>
                <p className="review__question">{r.card.question}</p>
                <p className="review__answer">
                  Answer: <strong>{r.card.answer}</strong>
                  {!r.correct && (
                    <>
                      {" "}
                      · You chose: <span className="strike">{r.picked}</span>
                    </>
                  )}
                </p>
                {!r.correct && r.card.explanation && (
                  <p className="review__explanation">{r.card.explanation}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
