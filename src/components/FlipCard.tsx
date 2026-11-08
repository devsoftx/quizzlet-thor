import { useEffect, useRef } from "react";
import type { Card } from "../deck";
import type { AnswerPoints } from "../points";

interface Props {
  card: Card;
  /** The option the user picked, or null while the question is open. */
  picked: string | null;
  /** Points for this answer, once answered. */
  earned: AnswerPoints | null;
  isLast: boolean;
  onPick: (option: string) => void;
  onNext: () => void;
}

const LETTERS = "ABCDEFGHIJ";

export function FlipCard({ card, picked, earned, isLast, onPick, onNext }: Props) {
  const flipped = picked !== null;
  const correct = picked === card.answer;
  const nextRef = useRef<HTMLButtonElement>(null);

  // Once flipped, move focus to "Next" so Enter/Space continue.
  useEffect(() => {
    if (flipped) nextRef.current?.focus({ preventScroll: true });
  }, [flipped]);

  return (
    <div className={`flip-card${flipped ? " is-flipped" : ""}`}>
      <div className="flip-card__inner">
        {/* Front: question + options */}
        <section className="flip-card__face flip-card__front" inert={flipped} aria-hidden={flipped}>
          <p className="eyebrow">Question</p>
          <h2 className={`question${card.question.length > 140 ? " question--long" : ""}`}>
            {card.question}
          </h2>
          <ol className="options">
            {card.options.map((option, i) => (
              <li key={option}>
                <button
                  type="button"
                  className={`option${picked === option ? " is-picked" : ""}`}
                  onClick={() => onPick(option)}
                >
                  <span className="option__key" aria-hidden="true">
                    {LETTERS[i] ?? i + 1}
                  </span>
                  <span className="option__text">{option}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="hint">
            Press <kbd>1</kbd>–<kbd>{Math.min(card.options.length, 9)}</kbd> or click an answer
          </p>
        </section>

        {/* Back: the verdict + correct answer. Always rendered (hidden until
            flipped) so the card keeps a steady height through the flip. */}
        <section
          className={`flip-card__face flip-card__back ${correct ? "is-correct" : "is-wrong"}`}
          inert={!flipped}
          aria-hidden={!flipped}
        >
          <div className="verdict-row">
            <p className="verdict" aria-live="polite">
              {flipped ? (correct ? "✓ Correct!" : "✗ Not quite") : ""}
            </p>
            {flipped && earned && earned.points > 0 && (
              <p className="points-badge">
                +{earned.points} pts
                {earned.bonus && <span className="points-badge__streak"> 🔥 {earned.streak} in a row</span>}
              </p>
            )}
          </div>
          <p className="back-question">{card.question}</p>
          <p className="eyebrow">Answer</p>
          <p className="answer">{card.answer}</p>
          <p className="your-pick">
            {correct ? (
              "Nice work."
            ) : (
              <>
                You chose <strong>{picked ?? "—"}</strong>
              </>
            )}
          </p>
          {card.explanation && <p className="explanation">{card.explanation}</p>}
          <div className="back-actions">
            <button ref={nextRef} type="button" className="btn btn--primary" onClick={onNext}>
              {isLast ? "See results" : "Next card"} →
            </button>
            <span className="hint">
              <kbd>Enter</kbd> to continue
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
