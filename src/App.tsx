import { useEffect, useState } from "react";
import type { AccountDeck, KidProfile } from "./account-shared";
import { api, ApiError, takeInviteToken, type AccountInfo, type KidHomeInfo, type ScoreResult, type SessionInfo } from "./api";
import { AUTH_MODE, useAccountAuth } from "./auth";
import { buildSession, type Card, type Deck } from "./deck";
import {
  accountDecksFor,
  loadBestScores,
  loadBundledDecks,
  loadImportedDecks,
  loadImportedTexts,
  recordScore,
  removeImportedDeck,
  saveImportedDeck,
  type DeckEntry,
} from "./library";
import { DeckList } from "./components/DeckList";
import { JoinInvite, KidHome } from "./components/KidScreens";
import { MyDecks } from "./components/MyDecks";
import { MyFiles } from "./components/MyFiles";
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
  | { status: "ready"; account: AccountInfo; profiles: KidProfile[]; decks: AccountDeck[] }
  | { status: "error"; message: string };

type Screen =
  | { name: "decks" }
  | { name: "profiles" }
  | { name: "settings" }
  | { name: "my-decks" }
  | { name: "my-files" }
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

/** An invitation link opened in this tab (#join=…), read once and removed from the address bar. */
const initialJoinToken = takeInviteToken();

/** A kid's own device, linked to their profile through an invitation (no account). */
type KidState = { status: "loading" } | { status: "none" } | { status: "linked"; kid: KidHomeInfo };

/** Screens that belong to a signed-in parent (not a kid's study session). */
const PARENT_SCREENS = new Set<Screen["name"]>(["profiles", "settings", "my-decks", "my-files"]);

export function App() {
  const [imported, setImported] = useState<DeckEntry[]>(loadImportedDecks);
  const [bestScores, setBestScores] = useState(loadBestScores);
  const [screen, setScreen] = useState<Screen>({ name: "decks" });
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });

  const auth = useAccountAuth();
  const [accountState, setAccountState] = useState<AccountState>({ status: "none" });
  const [importNote, setImportNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(initialJoinToken);
  const [kidState, setKidState] = useState<KidState>({ status: "loading" });

  const session = sessionState.status === "active" ? sessionState.session : null;
  const ready = accountState.status === "ready" ? accountState : null;
  const kid = kidState.status === "linked" && !auth.isSignedIn ? kidState.kid : null;
  // A kid studying under a parent's account sees the shared decks plus the
  // parent's decks meant for them (on the parent's device, or their own linked
  // one); guests see the shared and browser-imported decks.
  const kidId = session?.profileId && ready ? session.profileId : null;
  const onKidDevice = Boolean(kid && session?.profileId === kid.profile.id);
  const decks = kidId
    ? [...bundledDecks, ...accountDecksFor(ready!.decks, kidId)]
    : onKidDevice
      ? [...bundledDecks, ...accountDecksFor(kid!.decks, kid!.profile.id), ...imported]
      : [...bundledDecks, ...imported];

  // Is this a kid's linked device? (The link lives in an HttpOnly cookie, so ask the server.)
  useEffect(() => {
    api
      .kidHome()
      .then((k) => setKidState(k ? { status: "linked", kid: k } : { status: "none" }))
      .catch(() => setKidState({ status: "none" }));
  }, []);

  // An invitation link opened while the app is already open.
  useEffect(() => {
    const onHash = () => {
      const token = takeInviteToken();
      if (token !== null) setJoinToken(token);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Load the parent's account and kid profiles once signed in.
  useEffect(() => {
    if (!auth.isLoaded) return;
    if (!auth.isSignedIn) {
      setAccountState({ status: "none" });
      return;
    }
    setAccountState({ status: "loading" });
    Promise.all([api.getMe(), api.listDecks().catch(() => [] as AccountDeck[])])
      .then(([{ account, profiles }, decks]) => setAccountState({ status: "ready", account, profiles, decks }))
      .catch((err: Error) => setAccountState({ status: "error", message: err.message }));
  }, [auth.isLoaded, auth.isSignedIn]);

  // Apply the parent's theme choice ("system" follows the device).
  const theme = ready?.account.settings.theme ?? "system";
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function startKidSession() {
    try {
      const [s, fresh] = await Promise.all([api.startKidSession(), api.kidHome()]);
      if (fresh) setKidState({ status: "linked", kid: fresh }); // pick up the parent's latest decks
      setSessionState({ status: "active", session: s });
      setScreen({ name: "decks" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The parent removed this device (or deleted the profile).
        setKidState({ status: "none" });
        setSessionState({ status: "none", notice: err.message });
        return;
      }
      throw err;
    }
  }

  async function unlinkThisDevice() {
    await api.endSession().catch(() => undefined);
    await api.unlinkThisDevice();
    setKidState({ status: "none" });
    setSessionState({ status: "none", notice: "This device was removed. Ask your parent for a new link to study as yourself again." });
    setScreen({ name: "decks" });
  }

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
        const next = session.profileId ? "" : " Enter your name to start a new session.";
        setSessionState({
          status: "none",
          notice: `Time's up, ${session.name}! Your 60-minute session is over — you earned ${session.points} points.${next}`,
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
        ? {
            status: "none",
            notice: s.session.profileId ? "Your session has ended." : "Your session has ended. Enter your name to start a new one.",
          }
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
    setImportNote(null);
    if (kidId && ready) {
      // Signed in: decks go into the parent's account (for all their kids).
      let saved = ready.decks;
      const failed: string[] = [];
      for (const file of files) {
        try {
          saved = [...saved, await api.createDeck(file.name, await file.text())];
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof ApiError && err.details[0] ? err.details[0] : (err as Error).message}`);
        }
      }
      setAccountState({ ...ready, decks: saved });
      const added = saved.length - ready.decks.length;
      setImportNote(
        failed.length
          ? { kind: "error", text: `${added ? `Added ${added}. ` : ""}Couldn't add ${failed.join("; ")}` }
          : { kind: "ok", text: `Added ${added} deck${added === 1 ? "" : "s"} to your family's private decks.` },
      );
      return;
    }
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
  if (sessionState.status === "loading" || !auth.isLoaded || kidState.status === "loading") return loading;

  // An invitation link: link this device to a kid's profile (after they confirm).
  if (joinToken !== null) {
    return (
      <main className="app">
        <JoinInvite
          token={joinToken}
          onJoined={async (k) => {
            await api.endSession().catch(() => undefined); // any guest session on this device
            setKidState({ status: "linked", kid: k });
            setSessionState({ status: "none" });
            setScreen({ name: "decks" });
            setJoinToken(null);
          }}
          onClose={() => setJoinToken(null)}
        />
      </main>
    );
  }

  const notice = sessionState.status === "none" ? sessionState.notice : undefined;

  // Parent pages: kid profiles, private decks and files, settings.
  if (ready && screen.name === "my-decks") {
    return (
      <main className="app">
        <MyDecks
          decks={ready.decks}
          profiles={ready.profiles}
          browserDecks={loadImportedTexts()}
          onChange={(decks) => setAccountState((s) => (s.status === "ready" ? { ...s, decks } : s))}
          onBack={() => setScreen({ name: "decks" })}
        />
      </main>
    );
  }
  if (ready && screen.name === "my-files") {
    return (
      <main className="app">
        <MyFiles onBack={() => setScreen({ name: "decks" })} />
      </main>
    );
  }
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
  if (!session && (screen.name === "decks" || PARENT_SCREENS.has(screen.name))) {
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
            onDecks={() => setScreen({ name: "my-decks" })}
            onFiles={() => setScreen({ name: "my-files" })}
            onSettings={() => setScreen({ name: "settings" })}
            onSignOut={signOut}
          />
        </main>
      );
    }
    if (kid) {
      return (
        <main className="app">
          <KidHome profile={kid.profile} notice={notice} onStart={startKidSession} onUnlink={unlinkThisDevice} />
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
      {session && <SessionBar session={session} onEnd={endSession} endLabel={onKidDevice ? "Finish" : undefined} />}

      {screen.name === "decks" && (
        <DeckList
          decks={decks}
          bestScores={bestScores}
          onStart={(entry) => entry.ok && startQuiz(entry.id, entry.deck)}
          onImport={importFiles}
          onRemove={removeDeck}
          importNote={importNote}
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
