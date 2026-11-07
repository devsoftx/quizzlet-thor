import { useRef, useState, type DragEvent } from "react";
import type { DeckEntry } from "../library";

interface Props {
  decks: DeckEntry[];
  bestScores: Record<string, number>;
  onStart: (entry: DeckEntry) => void;
  onImport: (files: File[]) => void;
  onRemove: (entry: DeckEntry) => void;
}

const EXAMPLE = `title: Norse Mythology
description: Gods, realms and legends
shuffle: true          # shuffle card order (default: true)
shuffleOptions: true   # shuffle answer options (default: true)

cards:
  - question: Who is Thor's father?
    options:
      - Odin
      - Loki
      - Tyr
      - Baldur
    answer: Odin
    explanation: Odin, the All-Father, rules Asgard.  # optional`;

export function DeckList({ decks, bestScores, onStart, onImport, onRemove }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function yamlFiles(list: FileList | null): File[] {
    return Array.from(list ?? []).filter((f) => /\.ya?ml$/i.test(f.name));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = yamlFiles(e.dataTransfer.files);
    if (files.length) onImport(files);
  }

  return (
    <div
      className={`deck-list${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="app-header">
        <div>
          <h1 className="brand">
            <span aria-hidden="true">⚡</span> Quizzlet
          </h1>
          <p className="muted">Pick a deck. Answer each card. Watch it flip.</p>
        </div>
        <div>
          <button type="button" className="btn btn--secondary" onClick={() => fileInput.current?.click()}>
            Import YAML…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".yaml,.yml"
            multiple
            hidden
            onChange={(e) => {
              const files = yamlFiles(e.target.files);
              if (files.length) onImport(files);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {decks.length === 0 ? (
        <div className="empty">
          <p>No decks yet.</p>
          <p className="muted">
            Add <code>.yaml</code> files to the <code>decks/</code> folder, or drop one here.
          </p>
        </div>
      ) : (
        <ul className="decks">
          {decks.map((entry) => (
            <li key={entry.id}>
              {entry.ok ? (
                <article className="deck">
                  <div className="deck__body">
                    <h2>{entry.deck.title}</h2>
                    {entry.deck.description && <p className="muted">{entry.deck.description}</p>}
                  </div>
                  <div className="deck__meta">
                    <span>
                      {entry.deck.cards.length} card{entry.deck.cards.length === 1 ? "" : "s"}
                    </span>
                    {bestScores[entry.id] !== undefined && <span>Best {bestScores[entry.id]}%</span>}
                    {entry.source === "imported" && <span className="tag">Imported</span>}
                  </div>
                  <div className="deck__actions">
                    <button type="button" className="btn btn--primary" onClick={() => onStart(entry)}>
                      Study
                    </button>
                    {entry.source === "imported" && (
                      <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              ) : (
                <article className="deck deck--error">
                  <div className="deck__body">
                    <h2>{entry.fileName}</h2>
                    <p className="error-title">This deck has problems:</p>
                    <ul className="errors">
                      {entry.errors.slice(0, 5).map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                      {entry.errors.length > 5 && <li>…and {entry.errors.length - 5} more</li>}
                    </ul>
                  </div>
                  {entry.source === "imported" && (
                    <div className="deck__actions">
                      <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                        Remove
                      </button>
                    </div>
                  )}
                </article>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="format-help">
        <summary>How to write a deck (YAML format)</summary>
        <p className="muted">
          Put files in the project's <code>decks/</code> folder (they show up automatically), or import
          one here. <code>answer</code> must match one of the <code>options</code> exactly.
        </p>
        <pre>
          <code>{EXAMPLE}</code>
        </pre>
      </details>

      {dragging && <div className="drop-overlay">Drop YAML file to import</div>}
    </div>
  );
}
