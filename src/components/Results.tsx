import { useEffect, useRef, type CSSProperties } from "react";
import type { SaveState } from "../App";
import type { Deck } from "../deck";
import { LeaderboardPanel } from "./LeaderboardPanel";
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
  if (percent === 100) return "Every question answered. Wonderful work!";
  if (percent >= 80) return "Nice exploring. See what you discovered below.";
  if (percent >= 50) return "Every question is a chance to learn something new.";
  return "Curiosity starts with trying. Take another look below.";
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
          <p>Your session ended. {save.confirmedPoints.toLocaleString()} points were confirmed in this session. Recent points may not have been confirmed, and answers after the session ended were not saved.</p>
          <button type="button" className="btn btn--primary" onClick={onNewSession}>
            Start a new session
          </button>
        </div>
      );
    case "error":
      return (
        <div className="save-problem" role="alert">
          <p>{save.kind === "failed" ? "Your latest points were rejected." : save.kind === "waiting" ? "Your latest points are waiting to be saved." : "We couldn't confirm whether your latest points were saved."} {save.message}</p>
          {save.kind !== "failed" && <button type="button" className="btn btn--secondary" onClick={onRetrySave}>Try again</button>}
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
          <LeaderboardPanel collapsible />
        </>
      );
    }
  }
}

export function Results({
  deck,
  results,
  isRetry,
  save,
  onRetrySave,
  onNewSession,
  onRetryMissed,
  onRestart,
  onExit,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const correct = results.filter((r) => r.correct).length;
  const missed = results.length - correct;
  const percent = Math.round((correct / results.length) * 100);
  const roundPoints = results.reduce((sum, r) => sum + r.points, 0);

  return (
    <div className="results">
      <header className="results__summary">
        <p className="eyebrow">{isRetry ? `${deck.title} · missed questions` : deck.title}</p>
        <div
          className="score-ring"
          style={{ "--pct": `${percent}` } as CSSProperties}
          role="img"
          aria-label={`${percent}% correct`}
        >
          <span>{percent}%</span>
        </div>
        <h1 ref={headingRef} tabIndex={-1}>
          {correct} of {results.length} correct
        </h1>
        <p className="muted">
          {message(percent)}
        </p>
        <div className="results__actions">
          {missed > 0 && (
            <button type="button" className="btn btn--primary" onClick={onRetryMissed}>
              Practice missed questions ({missed})
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
            Explore more decks
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
