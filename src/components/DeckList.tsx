import { useEffect, useRef, useState, type DragEvent } from "react";
import { languageName, useI18n } from "../i18n";
import { rich } from "../i18n/rich";
import { deckLanguage, filterDecks, isVisible, TEMPLATE_URLS, type DeckEntry } from "../library";
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

export function DeckList({ decks: allDecks, onStart, onImport, onRemove, importNote }: Props) {
  const { language: appLanguage, t } = useI18n();
  const templateUrl = TEMPLATE_URLS[appLanguage];
  const fileInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("");
  const visible = allDecks.filter(isVisible);
  const subjects = [...new Set(visible.flatMap((entry) => entry.ok && entry.deck.subject ? [entry.deck.subject] : []))].sort();
  // Offered once the decks come in more than one language.
  const languages = [...new Set(visible.flatMap((entry) => (entry.ok && deckLanguage(entry.deck) ? [deckLanguage(entry.deck)!] : [])))].sort();
  const filtering = Boolean(query || subject || language);
  const decks = [...filterDecks(visible, query, subject, language), ...(!filtering ? visible.filter((entry) => !entry.ok) : [])];
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
          <h1 ref={headingRef} tabIndex={-1} className="field-page-title">{t.deckList.title}</h1>
          <p className="muted">{t.deckList.subtitle}</p>
        </div>
        <div className="app-header__actions">
          <a className="btn btn--ghost" href={templateUrl} download={t.common.templateFileName}>
            {t.common.downloadTemplate}
          </a>
          <button type="button" className="btn btn--secondary" onClick={() => fileInput.current?.click()}>
            {t.deckList.importYaml}
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
        <label htmlFor="deck-search">{t.deckList.search}</label>
        <input id="deck-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.deckList.searchPlaceholder} />
        {subjects.length > 0 && <label>{t.deckList.subject} <select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">{t.deckList.allSubjects}</option>{subjects.map((s) => <option key={s} value={s}>{s}</option>)}<option value="__uncategorized__">{t.common.uncategorized}</option></select></label>}
        {languages.length > 1 && <label>{t.deckList.deckLanguage} <select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="">{t.deckList.allLanguages}</option>{languages.map((code) => <option key={code} value={code}>{languageName(code, appLanguage)}</option>)}</select></label>}
      </div>

      <LeaderboardPanel collapsible />

      {importNote && (
        <p className={importNote.kind === "ok" ? "import-note" : "welcome__error"} role={importNote.kind === "ok" ? "status" : "alert"}>
          {importNote.text}
        </p>
      )}

      {decks.length === 0 ? (
        <div className="empty">
          {filtering ? (
            <><p>{t.deckList.noMatch}</p><p className="muted">{t.deckList.noMatchHint}</p></>
          ) : hidden.length > 0 ? (
            <>
              <p>{t.deckList.noEnabled}</p>
              <p className="muted">
                {t.deckList.noEnabledHint}
              </p>
            </>
          ) : (
            <>
              <p>{t.deckList.noDecks}</p>
              <p className="muted">
                {t.deckList.noDecksHint}
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
                    <h2 lang={entry.deck.language}>{entry.deck.title}</h2>
                    {entry.deck.description && <p className="muted" lang={entry.deck.language}>{entry.deck.description}</p>}
                  </div>
                  <div className="deck__meta">
                    <span>
                      {t.common.questionCount(entry.deck.cards.length)}
                    </span>
                    {entry.deck.subject ? <span lang={entry.deck.language}>{entry.deck.subject}</span> : <span>{t.common.uncategorized}</span>}
                    {/* Worth saying only when it isn't the app's language. */}
                    {entry.deck.language && deckLanguage(entry.deck) !== appLanguage && (
                      <span className="tag tag--language">{languageName(entry.deck.language, appLanguage)}</span>
                    )}
                    {entry.source === "imported" && <span className="tag">{t.common.imported}</span>}
                    {entry.source === "account" && <span className="tag tag--private">{t.common.private}</span>}
                  </div>
                  <div className="deck__actions">
                    <button type="button" className="btn btn--primary" aria-label={t.deckList.studyDeck(entry.deck.title)} onClick={() => onStart(entry)}>
                      {t.deckList.study}
                    </button>
                    {entry.source === "imported" && (
                      <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                        {t.common.remove}
                      </button>
                    )}
                  </div>
                </article>
              ) : (
                <article className="deck deck--error">
                  <div className="deck__body">
                    <h2>{entry.fileName}</h2>
                    <p className="error-title">{t.deckList.problems}</p>
                    <ul className="errors">
                      {entry.errors.slice(0, 5).map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                      {entry.errors.length > 5 && <li>{t.deckList.moreProblems(entry.errors.length - 5)}</li>}
                    </ul>
                  </div>
                  {entry.source === "imported" && (
                    <div className="deck__actions">
                      <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                        {t.common.remove}
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
            {t.deckList.hiddenCount(hidden.length)}
          </summary>
          <p className="muted">
            {rich(t.deckList.hiddenHint, { enabled: <code>enabled: true</code> })}
          </p>
          <ul>
            {hidden.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.ok ? entry.deck.title : entry.fileName}{" "}
                  <span className="muted">· {entry.fileName}</span>
                  {entry.source === "imported" && <span className="tag">{t.common.imported}</span>}
                </span>
                {entry.source === "imported" && (
                  <button type="button" className="btn btn--ghost" onClick={() => onRemove(entry)}>
                    {t.common.remove}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="format-help">
        <summary>{t.deckList.formatSummary}</summary>
        <p className="muted">
          {rich(t.deckList.formatHelp, {
            decks: <code>decks/</code>,
            enabled: <code>enabled: true</code>,
            answer: <code>answer</code>,
            options: <code>options</code>,
          })}
        </p>
        <p>
          <a href={templateUrl} download={t.common.templateFileName}>
            {t.deckList.templateLink}
          </a>{" "}
          <span className="muted">{t.deckList.templateLinkHint}</span>
        </p>
        <pre>
          <code>{t.deckList.example}</code>
        </pre>
      </details>

      {dragging && <div className="drop-overlay">{t.deckList.drop}</div>}
    </div>
  );
}
