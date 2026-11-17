import { useEffect, useRef } from "react";
import type { Card } from "../deck";
import type { AnswerPoints } from "../points";

interface Props {
  card: Card;
  picked: string | null;
  earned: AnswerPoints | null;
  isLast: boolean;
  onPick: (option: string) => void;
  onNext: () => void;
}

const LETTERS = "ABCDEFGHIJ";

export function FlipCard({ card, picked, earned, isLast, onPick, onNext }: Props) {
  const answered = picked !== null;
  const correct = picked === card.answer;
  const feedbackRef = useRef<HTMLElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (answered) feedbackRef.current?.focus({ preventScroll: true });
    else questionRef.current?.focus({ preventScroll: true });
  }, [answered]);

  return (
    <div className="question-sheet">
      <p className="question-sheet__label">Take a moment to think</p>
      <h2 ref={questionRef} tabIndex={-1} className="question">{card.question}</h2>
      {!answered ? (
        <>
          <ol className="options">
            {card.options.map((option, i) => (
              <li key={option}><button type="button" className="option" onClick={() => onPick(option)}>
                <span className="option__key" aria-hidden="true">{LETTERS[i] ?? i + 1}</span><span className="option__text">{option}</span>
              </button></li>
            ))}
          </ol>
          <p className="hint">Choose an answer or press a number key.</p>
        </>
      ) : (
        <section ref={feedbackRef} tabIndex={-1} className={`field-feedback ${correct ? "is-correct" : "is-wrong"}`} aria-labelledby="feedback-title">
          <p id="feedback-title" className="field-feedback__title">{correct ? "✓ That's right" : "Not quite — let's look at it"}</p>
          <p>The answer is <strong>{card.answer}</strong>.</p>
          {!correct && <p>You chose {picked}.</p>}
          {card.explanation && <p className="explanation">{card.explanation}</p>}
          {earned && earned.points > 0 && <p className="field-feedback__points">+{earned.points} points</p>}
          <button type="button" className="btn btn--primary" onClick={onNext}>{isLast ? "See results" : "Next question"} <span aria-hidden="true">→</span></button>
        </section>
      )}
    </div>
  );
}
