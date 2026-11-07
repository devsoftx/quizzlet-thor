import { useCallback, useEffect, useState } from "react";
import type { Card, Deck } from "../deck";
import { FlipCard } from "./FlipCard";

export interface AnswerRecord {
  card: Card;
  picked: string;
  correct: boolean;
}

interface Props {
  deck: Deck;
  cards: Card[];
  isRetry: boolean;
  onFinish: (results: AnswerRecord[]) => void;
  onExit: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function Quiz({ deck, cards, isRetry, onFinish, onExit }: Props) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AnswerRecord[]>([]);

  const card = cards[index];
  const current = results[index];
  const picked = current?.picked ?? null;
  const isLast = index === cards.length - 1;
  const score = results.filter((r) => r.correct).length;

  const pick = useCallback(
    (option: string) => {
      if (results.length > index) return; // already answered
      setResults((prev) => [...prev, { card, picked: option, correct: option === card.answer }]);
    },
    [card, index, results.length],
  );

  const next = useCallback(() => {
    if (results.length <= index) return; // not answered yet
    if (isLast) onFinish(results);
    else setIndex((i) => i + 1);
  }, [index, isLast, onFinish, results]);

  // Keyboard: 1–9 (or A–J) picks an option; → / Enter / Space continues.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;

      if (picked === null) {
        const key = e.key.toLowerCase();
        let i = -1;
        if (/^[1-9]$/.test(key)) i = Number(key) - 1;
        else if (/^[a-j]$/.test(key)) i = key.charCodeAt(0) - 97;
        if (i >= 0 && i < card.options.length) {
          e.preventDefault();
          pick(card.options[i]);
        }
        return;
      }

      // When a button has focus, let Enter/Space activate it natively.
      const onButton = e.target instanceof HTMLButtonElement;
      if (e.key === "ArrowRight" || (!onButton && (e.key === "Enter" || e.key === " "))) {
        e.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, picked, pick, next]);

  const progress = ((index + (picked ? 1 : 0)) / cards.length) * 100;

  return (
    <div className="quiz">
      <header className="quiz__header">
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          ← Decks
        </button>
        <div className="quiz__title">
          <h1>{deck.title}</h1>
          {isRetry && <span className="tag">Retrying missed</span>}
        </div>
        <div className="quiz__stats" aria-label="Progress">
          <span>
            {index + 1} / {cards.length}
          </span>
          <span className="quiz__score">✓ {score}</span>
        </div>
      </header>

      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div className="progress__bar" style={{ width: `${progress}%` }} />
      </div>

      {/* Keyed by index: each card mounts fresh (unflipped, no reverse animation
          that would briefly reveal the next card's answer). */}
      <FlipCard
        key={index}
        card={card}
        picked={picked}
        isLast={isLast}
        onPick={pick}
        onNext={next}
      />
    </div>
  );
}
