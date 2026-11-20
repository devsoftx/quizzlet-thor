import { useEffect, useRef } from "react";
import type { Card } from "../deck";
import { useI18n } from "../i18n";
import { rich } from "../i18n/rich";
import type { AnswerPoints } from "../points";

interface Props {
  card: Card;
  /** The language the deck is written in (for screen readers), when known. */
  lang?: string;
  /** The answer checked (the card has flipped), or null. */
  picked: string | null;
  /** The answer chosen but not checked yet. */
  selected: string | null;
  earned: AnswerPoints | null;
  isLast: boolean;
  onChoose: (option: string) => void;
  onSubmit: () => void;
  onNext: () => void;
}

const LETTERS = "ABCDEFGHIJ";

export function FlipCard({ card, lang, picked, selected, earned, isLast, onChoose, onSubmit, onNext }: Props) {
  const { t } = useI18n();
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
      <p className="question-sheet__label">{t.quiz.think}</p>
      <h2 ref={questionRef} tabIndex={-1} className="question" lang={lang}>{card.question}</h2>
      {!answered ? (
        <>
          <ol className="options">
            {card.options.map((option, i) => (
              <li key={option}><button type="button" className={`option${selected === option ? " is-selected" : ""}`} aria-pressed={selected === option} onClick={() => onChoose(option)}>
                <span className="option__key" aria-hidden="true">{LETTERS[i] ?? i + 1}</span><span className="option__text" lang={lang}>{option}</span>
              </button></li>
            ))}
          </ol>
          <div className="question-sheet__check">
            <button type="button" className="btn btn--primary" disabled={selected === null} onClick={onSubmit}>{t.quiz.check}</button>
            <p className="hint">{t.quiz.hint}</p>
          </div>
        </>
      ) : (
        <section ref={feedbackRef} tabIndex={-1} className={`field-feedback ${correct ? "is-correct" : "is-wrong"}`} aria-labelledby="feedback-title">
          <p id="feedback-title" className="field-feedback__title">{correct ? t.quiz.right : t.quiz.wrong}</p>
          <p>{rich(t.quiz.answerIs, { answer: <strong lang={lang}>{card.answer}</strong> })}</p>
          {!correct && <p>{rich(t.quiz.youChose("{picked}"), { picked: <span lang={lang}>{picked}</span> })}</p>}
          {card.explanation && <p className="explanation" lang={lang}>{card.explanation}</p>}
          {earned && earned.points > 0 && <p className="field-feedback__points">{t.quiz.plusPoints(earned.points)}</p>}
          <button type="button" className="btn btn--primary" onClick={onNext}>{isLast ? t.quiz.seeResults : t.quiz.next} <span aria-hidden="true">→</span></button>
        </section>
      )}
    </div>
  );
}
