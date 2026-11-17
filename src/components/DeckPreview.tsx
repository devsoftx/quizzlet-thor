import { useEffect, useRef } from "react";
import type { Deck } from "../deck";

export function DeckPreview({ deck, onStart, onBack }: { deck: Deck; onStart: () => void; onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className="deck-preview" aria-labelledby="preview-title">
      <button type="button" className="btn btn--ghost" onClick={onBack}>← Back to decks</button>
      <div className="deck-preview__content">
        <p className="field-kicker">Your next discovery</p>
        <h1 ref={headingRef} tabIndex={-1} id="preview-title">{deck.title}</h1>
        {deck.description && <p className="deck-preview__description">{deck.description}</p>}
        <p className="deck-preview__meta">{deck.cards.length} question{deck.cards.length === 1 ? "" : "s"} · {deck.subject ?? "Uncategorized"}</p>
        <button type="button" className="btn btn--primary" onClick={onStart}>Start practice <span aria-hidden="true">→</span></button>
      </div>
    </section>
  );
}
