import { useCallback, useEffect, useRef, useState } from "react";
import { capPicks, cardKey, MAX_ANSWER_MS, MAX_DECK_TITLE_CHARS, shortQuestion, type AttemptDetail } from "../attempts";
import { cardDifficulty, type Card, type Deck } from "../deck";
import { useI18n } from "../i18n";
import { pointsForAnswer } from "../points";
import { FlipCard } from "./FlipCard";

export interface AnswerRecord {
  card: Card;
  picked: string;
  correct: boolean;
  /** Points this answer earned (shown live; the server re-scores the round). */
  points: number;
  /** Correct answers in a row, including this one. */
  streak: number;
  bonus: boolean;
  /** What a parent's Progress page learns from this answer (sent only for kid profiles). */
  detail: AttemptDetail;
}

interface Props {
  /** The deck's id in the library ("bundled:…", "account:…", "imported:…"). */
  deckId: string;
  deck: Deck;
  cards: Card[];
  isRetry: boolean;
  onFinish: (results: AnswerRecord[]) => void;
  onExit: () => void;
  /** Called once per answered card, so its points can be saved right away. */
  onAnswer?: (correct: boolean, detail: AttemptDetail) => void;
}

/** The card as the deck file has it: options in the author's order, not shuffled. */
function deckCard(deck: Deck, card: Card): Card {
  return deck.cards.find((c) => c.question === card.question && c.answer === card.answer) ?? card;
}

/**
 * Time a card has been on screen, leaving out time the page was hidden (another
 * tab, a locked tablet), so stepping away doesn't read as a slow answer.
 */
function useCardClock(index: number) {
  const startedAtRef = useRef(0);
  const hiddenMsRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    startedAtRef.current = performance.now();
    hiddenMsRef.current = 0;
    hiddenSinceRef.current = document.visibilityState === "hidden" ? startedAtRef.current : null;
  }, [index]);

  useEffect(() => {
    function onVisibility() {
      const now = performance.now();
      if (document.visibilityState === "hidden") hiddenSinceRef.current ??= now;
      else if (hiddenSinceRef.current !== null) {
        hiddenMsRef.current += now - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return useCallback(() => {
    const now = performance.now();
    const hidden = hiddenMsRef.current + (hiddenSinceRef.current === null ? 0 : now - hiddenSinceRef.current);
    return Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(now - startedAtRef.current - hidden)));
  }, []);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function Quiz({ deckId, deck, cards, isRetry, onFinish, onExit, onAnswer }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AnswerRecord[]>([]);
  /** The answer chosen on this card but not checked yet. */
  const [selected, setSelected] = useState<string | null>(null);
  /** Every answer chosen on this card, in order (changing your mind is part of learning). */
  const picksRef = useRef<string[]>([]);
  /** The last card answered, so a fast double tap can't answer (or score) a card twice. */
  const answeredRef = useRef(-1);
  const elapsed = useCardClock(index);

  const card = cards[index];
  const current = results[index];
  const picked = current?.picked ?? null;
  const isLast = index === cards.length - 1;
  const score = results.filter((r) => r.correct).length;
  const points = results.reduce((sum, r) => sum + r.points, 0);

  /** Chooses an answer; nothing is final until it's checked. */
  const choose = useCallback(
    (option: string) => {
      if (results.length > index || answeredRef.current >= index) return; // already answered
      if (picksRef.current.at(-1) !== option) picksRef.current.push(option);
      setSelected(option);
    },
    [index, results.length],
  );

  /** Checks the chosen answer: the card flips and its points are saved. */
  const submit = useCallback(() => {
    if (selected === null || results.length > index || answeredRef.current >= index) return;
    answeredRef.current = index;
    const option = selected;
    const correct = option === card.answer;
    const original = deckCard(deck, card);
    const position = (o: string) => Math.max(0, original.options.indexOf(o));
    const detail: AttemptDetail = {
      deckKey: deckId,
      deckTitle: deck.title.slice(0, MAX_DECK_TITLE_CHARS),
      cardKey: cardKey(card),
      question: shortQuestion(card.question),
      difficulty: cardDifficulty(original, deck),
      ms: elapsed(),
      picks: capPicks(picksRef.current.map(position)),
      answerIndex: position(card.answer),
      optionCount: original.options.length,
      retry: isRetry,
    };
    onAnswer?.(correct, detail);
    setResults((prev) => {
      const earned = pointsForAnswer(correct, prev.at(-1)?.streak ?? 0);
      return [...prev, { card, picked: option, correct, ...earned, detail }];
    });
  }, [card, deck, deckId, elapsed, index, isRetry, onAnswer, results.length, selected]);

  /** Set once the round is handed over, so a double tap on the last card can't finish it twice. */
  const finishedRef = useRef(false);

  const next = useCallback(() => {
    if (results.length <= index) return; // not answered yet
    if (isLast) {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinish(results);
      return;
    }
    // Only move on from *this* card: a second tap before the screen updates
    // must not skip the next card (which would leave the quiz stuck).
    picksRef.current = [];
    setSelected(null);
    setIndex((i) => (i === index ? i + 1 : i));
  }, [index, isLast, onFinish, results]);

  // Keyboard: 1–9 (or A–J) chooses an option, Enter / Space checks it; → / Enter / Space continues.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      // Character shortcuts are active only while the question itself has focus.
      if (!(e.target instanceof HTMLElement) || !e.target.closest(".question-sheet")) return;

      // When a button has focus, let Enter/Space activate it natively.
      const onButton = e.target instanceof HTMLButtonElement;
      const confirmKey = !onButton && (e.key === "Enter" || e.key === " ");

      if (picked === null) {
        const key = e.key.toLowerCase();
        let i = -1;
        if (/^[1-9]$/.test(key)) i = Number(key) - 1;
        else if (/^[a-j]$/.test(key)) i = key.charCodeAt(0) - 97;
        if (i >= 0 && i < card.options.length) {
          e.preventDefault();
          choose(card.options[i]);
        } else if (confirmKey && selected !== null) {
          e.preventDefault();
          submit();
        }
        return;
      }

      if (e.key === "ArrowRight" || confirmKey) {
        e.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, picked, selected, choose, submit, next]);

  const progress = ((index + (picked ? 1 : 0)) / cards.length) * 100;

  return (
    <div className="quiz">
      <header className="quiz__header">
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t.quiz.back}
        </button>
        <div className="quiz__title">
          <h1 lang={deck.language}>{deck.title}</h1>
          {isRetry && <span className="tag">{t.quiz.retrying}</span>}
        </div>
        <div className="quiz__stats" aria-label={t.quiz.progress}>
          <span>
            {index + 1} / {cards.length}
          </span>
          <span className="quiz__score">✓ {score}</span>
          <span className="quiz__points" aria-label={t.quiz.roundPoints(points)}>
            ⭐ {points}
          </span>
        </div>
      </header>

      <div
        className="progress"
        role="progressbar"
        aria-label={t.quiz.answered}
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
        lang={deck.language}
        picked={picked}
        selected={selected}
        earned={current ? { points: current.points, streak: current.streak, bonus: current.bonus } : null}
        isLast={isLast}
        onChoose={choose}
        onSubmit={submit}
        onNext={next}
      />
    </div>
  );
}
