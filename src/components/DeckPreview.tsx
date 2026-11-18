import { useEffect, useRef } from "react";
import type { Deck } from "../deck";
import { useI18n } from "../i18n";

export function DeckPreview({ deck, onStart, onBack }: { deck: Deck; onStart: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className="deck-preview" aria-labelledby="preview-title">
      <button type="button" className="btn btn--ghost" onClick={onBack}>{t.preview.back}</button>
      <div className="deck-preview__content">
        <p className="field-kicker">{t.preview.kicker}</p>
        <h1 ref={headingRef} tabIndex={-1} id="preview-title" lang={deck.language}>{deck.title}</h1>
        {deck.description && <p className="deck-preview__description" lang={deck.language}>{deck.description}</p>}
        <p className="deck-preview__meta">{t.common.questionCount(deck.cards.length)} · <span lang={deck.subject ? deck.language : undefined}>{deck.subject ?? t.common.uncategorized}</span></p>
        <button type="button" className="btn btn--primary" onClick={onStart}>{t.preview.start} <span aria-hidden="true">→</span></button>
      </div>
    </section>
  );
}
