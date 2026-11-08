import { useEffect, useState } from "react";
import { api, ApiError, type ScoreResult, type SessionInfo } from "./api";
import { buildSession, type Card, type Deck } from "./deck";
import {
  loadBestScores,
  loadBundledDecks,
  loadImportedDecks,
  recordScore,
  removeImportedDeck,
  saveImportedDeck,
  type DeckEntry,
} from "./library";
import { DeckList } from "./components/DeckList";
import { Quiz, type AnswerRecord } from "./components/Quiz";
import { Results } from "./components/Results";
import { SessionBar } from "./components/SessionBar";
import { Welcome } from "./components/Welcome";

type SessionState =
  | { status: "loading" }
  | { status: "none"; notice?: string }
  | { status: "active"; session: SessionInfo };

/** Saving a finished round's points to the server. */
export type SaveState =
  | { status: "saving" }
  | { status: "saved"; result: ScoreResult }
  | { status: "expired" }
  | { status: "error"; message: string };

type Screen =
  | { name: "decks" }
  | { name: "quiz"; deckId: string; deck: Deck; cards: Card[]; isRetry: boolean; run: number }
  | {
      name: "results";
      deckId: string;
      deck: Deck;
      results: AnswerRecord[];
      isRetry: boolean;
      newBest: boolean;
      run: number;
      save: SaveState;
    };

const bundledDecks = loadBundledDecks();

export function App() {
  const [imported, setImported] = useState<DeckEntry[]>(loadImportedDecks);
  const [bestScores, setBestScores] = useState(loadBestScores);
  const [screen, setScreen] = useState<Screen>({ name: "decks" });
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });

  const decks = [...bundledDecks, ...imported];
  const session = sessionState.status === "active" ? sessionState.session : null;

  // Resume an existing session (the cookie is HttpOnly, so ask the server).
  useEffect(() => {
    api
      .getSession()
      .then((s) => setSessionState(s ? { status: "active", session: s } : { status: "none" }))
      .catch((err: Error) => setSessionState({ status: "none", notice: err.message }));
  }, []);

  // End the session in the UI when its 60 minutes are up. A round in
  // progress can still be finished; its points just won't be saved.
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      () => {
        setSessionState({
          status: "none",
          notice: `Time's up, ${session.name}! Your 60-minute session is over — you earned ${session.points} points. Enter your name to start a new session.`,
        });
      },
      Math.max(0, session.deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session]);

  async function startSession(name: string) {
    const s = await api.startSession(name);
    setSessionState({ status: "active", session: s });
    setScreen({ name: "decks" });
  }

  async function endSession() {
    await api.endSession().catch(() => undefined);
    setSessionState({ status: "none" });
    setScreen({ name: "decks" });
  }

  function sessionExpired() {
    setSessionState((s) =>
      s.status === "active"
        ? { status: "none", notice: "Your session has ended. Enter your name to start a new one." }
        : s,
    );
  }

  function startQuiz(deckId: string, deck: Deck, cards: Card[] = deck.cards, isRetry = false) {
    setScreen({
      name: "quiz",
      deckId,
      deck,
      cards: buildSession(deck, cards),
      isRetry,
      run: Date.now(), // remounts <Quiz> for a fresh session
    });
    window.scrollTo({ top: 0 });
  }

  function saveRound(answers: boolean[], run: number) {
    const update = (save: SaveState) =>
      setScreen((sc) => (sc.name === "results" && sc.run === run ? { ...sc, save } : sc));

    update({ status: "saving" });
    api
      .submitScore(answers)
      .then((result) => {
        setSessionState((s) =>
          s.status === "active" ? { ...s, session: { ...s.session, points: result.sessionPoints } } : s,
        );
        update({ status: "saved", result });
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.status === 401) {
          sessionExpired();
          update({ status: "expired" });
        } else {
          update({ status: "error", message: err.message });
        }
      });
  }

  function finishQuiz(deckId: string, deck: Deck, isRetry: boolean, run: number, results: AnswerRecord[]) {
    let newBest = false;
    if (!isRetry) {
      const percent = Math.round((results.filter((r) => r.correct).length / results.length) * 100);
      newBest = recordScore(deckId, percent);
      setBestScores(loadBestScores());
    }
    setScreen({ name: "results", deckId, deck, results, isRetry, newBest, run, save: { status: "saving" } });
    saveRound(
      results.map((r) => r.correct),
      run,
    );
    window.scrollTo({ top: 0 });
  }

  async function importFiles(files: File[]) {
    const entries = await Promise.all(
      files.map(async (file) => saveImportedDeck(file.name, await file.text())),
    );
    setImported((prev) => [
      ...prev.filter((p) => !entries.some((e) => e.id === p.id)),
      ...entries,
    ]);
  }

  function removeDeck(entry: DeckEntry) {
    removeImportedDeck(entry.fileName);
    setImported((prev) => prev.filter((p) => p.id !== entry.id));
  }

  if (sessionState.status === "loading") {
    return (
      <main className="app">
        <p className="muted loading">Loading…</p>
      </main>
    );
  }

  // No session: the welcome page, unless a round is still being finished.
  if (!session && screen.name === "decks") {
    return (
      <main className="app">
        <Welcome
          notice={sessionState.status === "none" ? sessionState.notice : undefined}
          onStart={startSession}
        />
      </main>
    );
  }

  return (
    <main className="app">
      {session && <SessionBar session={session} onEnd={endSession} />}

      {screen.name === "decks" && (
        <DeckList
          decks={decks}
          bestScores={bestScores}
          onStart={(entry) => entry.ok && startQuiz(entry.id, entry.deck)}
          onImport={importFiles}
          onRemove={removeDeck}
        />
      )}

      {screen.name === "quiz" && (
        <Quiz
          key={screen.run}
          deck={screen.deck}
          cards={screen.cards}
          isRetry={screen.isRetry}
          onFinish={(results) =>
            finishQuiz(screen.deckId, screen.deck, screen.isRetry, screen.run, results)
          }
          onExit={() => setScreen({ name: "decks" })}
        />
      )}

      {screen.name === "results" && (
        <Results
          deck={screen.deck}
          results={screen.results}
          isRetry={screen.isRetry}
          newBest={screen.newBest}
          save={screen.save}
          onRetrySave={() =>
            saveRound(
              screen.results.map((r) => r.correct),
              screen.run,
            )
          }
          onNewSession={() => setScreen({ name: "decks" })}
          onRetryMissed={() =>
            startQuiz(
              screen.deckId,
              screen.deck,
              screen.results.filter((r) => !r.correct).map((r) => r.card),
              true,
            )
          }
          onRestart={() => startQuiz(screen.deckId, screen.deck)}
          onExit={() => setScreen({ name: "decks" })}
        />
      )}
    </main>
  );
}
