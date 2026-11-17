import { useEffect, useRef, useState, type DragEvent } from "react";
import { filterDecks, isVisible, TEMPLATE_URL, type DeckEntry } from "../library";
import { LeaderboardPanel } from "./LeaderboardPanel";

interface Props {
  decks: DeckEntry[];
  bestScores: Record<string, number>;
  onStart: (entry: DeckEntry) => void;
  onImport: (files: File[]) => void;
  onRemove: (entry: DeckEntry) => void;
  /** Result of the last import (shown under the header), e.g. when decks go to a parent's account. */
  importNote?: { kind: "ok" | "error"; text: string } | null;
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

export function DeckList({ decks: allDecks, onStart, onImport, onRemove, importNote }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const visible = allDecks.filter(isVisible);
  const subjects = [...new Set(visible.flatMap((entry) => entry.ok && entry.deck.subject ? [entry.deck.subject] : []))].sort();
  const decks = [...filterDecks(visible, query, subject), ...(!query && !subject ? visible.filter((entry) => !entry.ok) : [])];
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
          <p className="field-mark"><span aria-hidden="true">✳</span> Quizzlet</p>
          <h1 ref={headingRef} tabIndex={-1} className="field-page-title">Explore decks</h1>
          <p className="muted">Find something interesting. See what you know.</p>
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

      <div className="deck-search">
        <label htmlFor="deck-search">Search decks</label>
        <input id="deck-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or description" />
        {subjects.length > 0 && <label>Subject <select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map((s) => <option key={s} value={s}>{s}</option>)}<option value="__uncategorized__">Uncategorized</option></select></label>}
      </div>

      <LeaderboardPanel collapsible />

      {importNote && (
        <p className={importNote.kind === "ok" ? "import-note" : "welcome__error"} role={importNote.kind === "ok" ? "status" : "alert"}>
          {importNote.text}
        </p>
      )}

      {decks.length === 0 ? (
        <div className="empty">
          {query || subject ? (
            <><p>No decks match that search.</p><p className="muted">Try another word or subject.</p></>
          ) : hidden.length > 0 ? (
            <>
              <p>No enabled decks.</p>
              <p className="muted">
                Ask an adult to make a deck available.
              </p>
            </>
          ) : (
            <>
              <p>No decks yet.</p>
              <p className="muted">
                Ask an adult to add a deck, or import one here.
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
                      {entry.deck.cards.length} question{entry.deck.cards.length === 1 ? "" : "s"}
                    </span>
                    <span>{entry.deck.subject ?? "Uncategorized"}</span>
                    {entry.source === "imported" && <span className="tag">Imported</span>}
                    {entry.source === "account" && <span className="tag tag--private">Private</span>}
                  </div>
                  <div className="deck__actions">
                    <button type="button" className="btn btn--primary" aria-label={`Study ${entry.deck.title}`} onClick={() => onStart(entry)}>
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
