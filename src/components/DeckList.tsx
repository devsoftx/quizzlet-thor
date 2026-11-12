import { useRef, useState, type DragEvent } from "react";
import { isVisible, TEMPLATE_URL, type DeckEntry } from "../library";

interface Props {
  decks: DeckEntry[];
  bestScores: Record<string, number>;
  onStart: (entry: DeckEntry) => void;
  onImport: (files: File[]) => void;
  onRemove: (entry: DeckEntry) => void;
}

const TEMPLATE_FILE_NAME = "quizzlet-deck-template.yaml";

const EXAMPLE = `title: Norse Mythology
description: Gods, realms and legends
enabled: true          # required: only enabled decks are shown
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

export function DeckList({ decks: allDecks, bestScores, onStart, onImport, onRemove }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const decks = allDecks.filter(isVisible);
  const hidden = allDecks.filter((d) => !isVisible(d));

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
        <div className="app-header__actions">
          <a className="btn btn--ghost" href={TEMPLATE_URL} download={TEMPLATE_FILE_NAME}>
            Download template
          </a>
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
          {hidden.length > 0 ? (
            <>
              <p>No enabled decks.</p>
              <p className="muted">
                Set <code>enabled: true</code> in a deck's YAML file to show it here.
              </p>
            </>
          ) : (
            <>
              <p>No decks yet.</p>
              <p className="muted">
                Add <code>.yaml</code> files to the <code>decks/</code> folder, or drop one here.
              </p>
            </>
          )}
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

      {hidden.length > 0 && (
        <details className="hidden-decks">
          <summary>
            {hidden.length} deck{hidden.length === 1 ? "" : "s"} hidden (not enabled)
          </summary>
          <p className="muted">
            Set <code>enabled: true</code> at the top of the YAML file to show a deck.
          </p>
          <ul>
            {hidden.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.ok ? entry.deck.title : entry.fileName}{" "}
                  <span className="muted">· {entry.fileName}</span>
                  {entry.source === "imported" && <span className="tag">Imported</span>}
                </span>
                {entry.source === "imported" && (
                  <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="format-help">
        <summary>How to write a deck (YAML format)</summary>
        <p className="muted">
          Put files in the project's <code>decks/</code> folder (they show up automatically), or import
          one here. Only decks with <code>enabled: true</code> are shown, and <code>answer</code> must
          match one of the <code>options</code> exactly.
        </p>
        <p>
          <a href={TEMPLATE_URL} download={TEMPLATE_FILE_NAME}>
            Download the deck template
          </a>{" "}
          <span className="muted">— a commented example to copy and fill in.</span>
        </p>
        <pre>
          <code>{EXAMPLE}</code>
        </pre>
      </details>

      {dragging && <div className="drop-overlay">Drop YAML file to import</div>}
    </div>
  );
}
