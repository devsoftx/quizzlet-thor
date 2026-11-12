import { useEffect, useState } from "react";
import type { KidProfile } from "./account-shared";
import { api, ApiError, type AccountInfo, type ScoreResult, type SessionInfo } from "./api";
import { AUTH_MODE, useAccountAuth } from "./auth";
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
import { ParentHome } from "./components/ParentHome";
import { ProfilesManager } from "./components/ProfilesManager";
import { Quiz, type AnswerRecord } from "./components/Quiz";
import { Results } from "./components/Results";
import { SessionBar } from "./components/SessionBar";
import { Settings } from "./components/Settings";
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

/** The signed-in parent's account (loaded after sign-in). */
type AccountState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; account: AccountInfo; profiles: KidProfile[] }
  | { status: "error"; message: string };

type Screen =
  | { name: "decks" }
  | { name: "profiles" }
  | { name: "settings" }
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

  const auth = useAccountAuth();
  const [accountState, setAccountState] = useState<AccountState>({ status: "none" });

  const decks = [...bundledDecks, ...imported];
  const session = sessionState.status === "active" ? sessionState.session : null;
  const ready = accountState.status === "ready" ? accountState : null;

  // Load the parent's account and kid profiles once signed in.
  useEffect(() => {
    if (!auth.isLoaded) return;
    if (!auth.isSignedIn) {
      setAccountState({ status: "none" });
      return;
    }
    setAccountState({ status: "loading" });
    api
      .getMe()
      .then(({ account, profiles }) => setAccountState({ status: "ready", account, profiles }))
      .catch((err: Error) => setAccountState({ status: "error", message: err.message }));
  }, [auth.isLoaded, auth.isSignedIn]);

  // Apply the parent's theme choice ("system" follows the device).
  const theme = ready?.account.settings.theme ?? "system";
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function startProfileSession(profileId: string) {
    const s = await api.startProfileSession(profileId);
    setSessionState({ status: "active", session: s });
    setScreen({ name: "decks" });
  }

  async function signOut() {
    await api.endSession().catch(() => undefined);
    await auth.signOut();
    setSessionState({ status: "none" });
    setAccountState({ status: "none" });
    setScreen({ name: "decks" });
  }

  async function accountDeleted() {
    await auth.signOut();
    setAccountState({ status: "none" });
    setSessionState({ status: "none", notice: "Your account and all its kid profiles were deleted." });
    setScreen({ name: "decks" });
  }

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
    // A signed-in parent's "card order" setting overrides each deck's choice.
    const shuffle = ready?.account.settings.shuffle ?? "deck";
    const forRun = shuffle === "deck" ? deck : { ...deck, shuffle: shuffle === "on" };
    setScreen({
      name: "quiz",
      deckId,
      deck,
      cards: buildSession(forRun, cards),
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

  const loading = (
    <main className="app">
      <p className="muted loading">Loading…</p>
    </main>
  );
  if (sessionState.status === "loading" || !auth.isLoaded) return loading;

  const notice = sessionState.status === "none" ? sessionState.notice : undefined;

  // Parent pages: manage kid profiles, settings.
  if (ready && screen.name === "profiles") {
    return (
      <main className="app">
        <ProfilesManager
          profiles={ready.profiles}
          onChange={(profiles) => setAccountState({ ...ready, profiles })}
          onBack={() => setScreen({ name: "decks" })}
        />
      </main>
    );
  }
  if (ready && screen.name === "settings") {
    return (
      <main className="app">
        <Settings
          account={ready.account}
          onSaved={(account) => setAccountState({ ...ready, account })}
          onDeleted={accountDeleted}
          onBack={() => setScreen({ name: "decks" })}
        />
      </main>
    );
  }

  // No session: a signed-in parent picks a kid profile; everyone else gets the
  // guest welcome. (A round still being finished keeps going either way.)
  if (!session && (screen.name === "decks" || screen.name === "profiles" || screen.name === "settings")) {
    if (auth.isSignedIn) {
      if (accountState.status === "loading" || accountState.status === "none") return loading;
      if (accountState.status === "error") {
        return (
          <main className="app">
            <div className="welcome">
              <p className="welcome__error" role="alert">
                Couldn't load your account: {accountState.message}
              </p>
              <button type="button" className="btn btn--secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          </main>
        );
      }
      return (
        <main className="app">
          <ParentHome
            displayName={accountState.account.displayName}
            profiles={accountState.profiles}
            notice={notice}
            onPick={startProfileSession}
            onManage={() => setScreen({ name: "profiles" })}
            onSettings={() => setScreen({ name: "settings" })}
            onSignOut={signOut}
          />
        </main>
      );
    }
    return (
      <main className="app">
        <Welcome
          notice={notice}
          onStart={startSession}
          parentSignIn={
            AUTH_MODE === "off"
              ? undefined
              : {
                  label: AUTH_MODE === "dev" ? "Sign in (local dev)" : "Sign in with Google",
                  onClick: auth.signIn,
                }
          }
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
