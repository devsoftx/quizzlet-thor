import { useEffect, useRef, type CSSProperties } from "react";
import type { SaveState } from "../App";
import type { Deck } from "../deck";
import { useI18n, type Messages } from "../i18n";
import { rich } from "../i18n/rich";
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

function message(percent: number, t: Messages): string {
  if (percent === 100) return t.results.perfect;
  if (percent >= 80) return t.results.great;
  if (percent >= 50) return t.results.good;
  return t.results.keepGoing;
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
  const { t } = useI18n();
  switch (save.status) {
    case "saving":
      return (
        <p className="muted" role="status">
          {t.results.saving(roundPoints)}
        </p>
      );
    case "expired":
      return (
        <div className="save-problem" role="alert">
          <p>{t.results.expired(save.confirmedPoints)}</p>
          <button type="button" className="btn btn--primary" onClick={onNewSession}>
            {t.results.newSession}
          </button>
        </div>
      );
    case "error":
      return (
        <div className="save-problem" role="alert">
          <p>{save.kind === "failed" ? t.results.rejected : t.results.unknown} {save.message}</p>
          {save.kind === "unknown" && <button type="button" className="btn btn--secondary" onClick={onRetrySave}>{t.results.tryAgain}</button>}
        </div>
      );
    case "saved": {
      const { result } = save;
      return (
        <>
          <div className="points-summary">
            <div className="points-summary__earned">
              <span className="points-summary__big">+{result.pointsEarned.toLocaleString(t.locale)}</span>
              <span className="muted">{t.results.pointsThisRound}</span>
            </div>
            <div className="points-summary__totals">
              <span>
                {t.results.thisSession} <strong>{result.sessionPoints.toLocaleString(t.locale)}</strong>
              </span>
              <span>
                {t.results.allTime} <strong>{result.totalPoints.toLocaleString(t.locale)}</strong>
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
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const correct = results.filter((r) => r.correct).length;
  const missed = results.length - correct;
  const percent = Math.round((correct / results.length) * 100);
  const roundPoints = results.reduce((sum, r) => sum + r.points, 0);

  return (
    <div className="results">
      <header className="results__summary">
        <p className="eyebrow">{rich(isRetry ? t.results.missedEyebrow("{title}") : "{title}", { title: <span lang={deck.language}>{deck.title}</span> })}</p>
        <div
          className="score-ring"
          style={{ "--pct": `${percent}` } as CSSProperties}
          role="img"
          aria-label={t.results.percentCorrect(percent)}
        >
          <span>{t.results.percent(percent)}</span>
        </div>
        <h1 ref={headingRef} tabIndex={-1}>
          {t.results.correctOf(correct, results.length)}
        </h1>
        <p className="muted">
          {message(percent, t)}
        </p>
        <div className="results__actions">
          {missed > 0 && (
            <button type="button" className="btn btn--primary" onClick={onRetryMissed}>
              {t.results.practiceMissed(missed)}
            </button>
          )}
          <button
            type="button"
            className={`btn ${missed > 0 ? "btn--secondary" : "btn--primary"}`}
            onClick={onRestart}
          >
            {t.results.restart}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            {t.results.exploreMore}
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
        <h2 className="section-title">{t.results.review}</h2>
        <ol className="review">
          {results.map((r, i) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- a fixed list, in the order answered
            <li key={i} className={`review__item ${r.correct ? "is-correct" : "is-wrong"}`}>
              <span className="review__mark" aria-label={r.correct ? t.results.correct : t.results.wrong}>
                {r.correct ? "✓" : "✗"}
              </span>
              <div>
                <p className="review__question" lang={deck.language}>{r.card.question}</p>
                <p className="review__answer">
                  {t.results.answer} <strong lang={deck.language}>{r.card.answer}</strong>
                  {!r.correct && (
                    <>
                      {" "}
                      · {t.results.youChose} <span className="strike" lang={deck.language}>{r.picked}</span>
                    </>
                  )}
                </p>
                {!r.correct && r.card.explanation && (
                  <p className="review__explanation" lang={deck.language}>{r.card.explanation}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
