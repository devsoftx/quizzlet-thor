import { useRef, useState, type FormEvent } from "react";
import { MAX_DECKS, type AccountDeck, type KidProfile } from "../account-shared";
import { api, ApiError } from "../api";
import { TEMPLATE_URL } from "../library";
import { ProfileAvatar } from "./ParentHome";

interface Props {
  decks: AccountDeck[];
  profiles: KidProfile[];
  /** Decks imported into this browser (guest mode), which can be copied into the account. */
  browserDecks: Array<{ fileName: string; text: string }>;
  onChange: (decks: AccountDeck[]) => void;
  onBack: () => void;
}

interface UploadProblem {
  fileName: string;
  message: string;
  details: string[];
}

function audience(deck: AccountDeck, profiles: KidProfile[]): string {
  if (!deck.enabled) return "Off: hidden from every kid";
  if (deck.profileIds === null) return "All kids";
  const names = profiles.filter((p) => deck.profileIds!.includes(p.id)).map((p) => p.nickname);
  return names.length ? names.join(", ") : "No kids picked yet";
}

function saveText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const yamlName = (title: string) => `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "deck"}.yaml`;

function DeckForm({
  deck,
  profiles,
  onSave,
  onDelete,
  onCancel,
}: {
  deck: AccountDeck;
  profiles: KidProfile[];
  onSave: (patch: { title: string; profileIds: string[] | null }) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(deck.title);
  const [everyone, setEveryone] = useState(deck.profileIds === null);
  const [picked, setPicked] = useState<string[]>(deck.profileIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(() => onSave({ title, profileIds: everyone ? null : picked }));
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
      </label>
      <fieldset className="field">
        <legend>Who can study it</legend>
        <label className="check">
          <input type="radio" name={`who-${deck.id}`} checked={everyone} onChange={() => setEveryone(true)} />
          <span>All my kids</span>
        </label>
        <label className="check">
          <input type="radio" name={`who-${deck.id}`} checked={!everyone} onChange={() => setEveryone(false)} />
          <span>Only these kids:</span>
        </label>
        {!everyone &&
          (profiles.length === 0 ? (
            <p className="muted field__hint">Add kid profiles first.</p>
          ) : (
            <div className="kid-checks">
              {profiles.map((p) => (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={picked.includes(p.id)}
                    onChange={(e) => setPicked((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))}
                  />
                  <ProfileAvatar profile={p} size={26} />
                  <span>{p.nickname}</span>
                </label>
              ))}
            </div>
          ))}
      </fieldset>
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !title.trim()}>
          Save
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => saveText(deck.yaml, yamlName(deck.title))}>
          Download YAML
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${deck.title}"? This can't be undone.`)) run(onDelete);
          }}
        >
          Delete deck
        </button>
      </div>
    </form>
  );
}

/** A parent's private decks: add, switch on/off, pick which kids see each one. */
export function MyDecks({ decks, profiles, browserDecks, onChange, onBack }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<UploadProblem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Browser decks whose exact text isn't in the account yet.
  const saved = new Set(decks.map((d) => d.yaml));
  const notCopied = browserDecks.filter((d) => !saved.has(d.text));

  async function addAll(items: Array<{ fileName: string; text: string }>) {
    setProblems([]);
    setError(null);
    let current = decks;
    const failed: UploadProblem[] = [];
    for (const [i, item] of items.entries()) {
      setBusy(`Adding ${i + 1} of ${items.length}…`);
      try {
        current = [...current, await api.createDeck(item.fileName, item.text)];
        onChange(current);
      } catch (err) {
        failed.push({
          fileName: item.fileName,
          message: err instanceof Error ? err.message : "Couldn't add this deck.",
          details: err instanceof ApiError ? err.details : [],
        });
      }
    }
    setProblems(failed);
    setBusy(null);
  }

  async function pickFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.ya?ml$/i.test(f.name));
    if (files.length) await addAll(await Promise.all(files.map(async (f) => ({ fileName: f.name, text: await f.text() }))));
  }

  async function toggle(deck: AccountDeck, enabled: boolean) {
    setError(null);
    try {
      const updated = await api.updateDeck(deck.id, { enabled });
      onChange(decks.map((d) => (d.id === deck.id ? updated : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change that deck.");
    }
  }

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
        <h1>My decks</h1>
      </header>
      <p className="muted manage__intro">
        Decks you add here are private to your account. Your kids see them next to the shared decks. Switch a deck
        off to hide it, or pick which kids see it.
      </p>

      <div className="manage__toolbar">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null || decks.length >= MAX_DECKS}
        >
          + Add YAML deck…
        </button>
        <a className="btn btn--ghost" href={TEMPLATE_URL} download="quizzlet-deck-template.yaml">
          Download template
        </a>
        <span className="muted manage__count">
          {decks.length} of {MAX_DECKS} decks
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml"
          multiple
          hidden
          onChange={(e) => {
            pickFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <div className="welcome__error upload-problems" role="alert">
          {problems.map((p) => (
            <div key={p.fileName}>
              <strong>{p.fileName}:</strong> {p.message}
              {p.details.length > 0 && (
                <ul className="errors">
                  {p.details.slice(0, 5).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {notCopied.length > 0 && (
        <div className="manage__item library-banner">
          <span>
            {notCopied.length} deck{notCopied.length === 1 ? " is" : "s are"} saved only in this browser.
          </span>
          <button type="button" className="btn btn--secondary" disabled={busy !== null} onClick={() => addAll(notCopied)}>
            Copy to my account
          </button>
        </div>
      )}

      {decks.length === 0 ? (
        <div className="empty">
          <p>No decks yet.</p>
          <p className="muted">Start from the template, fill in your questions, then add the file here.</p>
        </div>
      ) : (
        <ul className="manage__list">
          {decks.map((d) => (
            <li key={d.id} className="manage__item">
              {editing === d.id ? (
                <DeckForm
                  deck={d}
                  profiles={profiles}
                  onCancel={() => setEditing(null)}
                  onSave={async (patch) => {
                    const updated = await api.updateDeck(d.id, patch);
                    onChange(decks.map((x) => (x.id === d.id ? updated : x)));
                    setEditing(null);
                  }}
                  onDelete={async () => {
                    await api.deleteDeck(d.id);
                    onChange(decks.filter((x) => x.id !== d.id));
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="manage__row manage__row--wrap">
                  <div className="manage__info">
                    <strong>{d.title}</strong>
                    <span className="muted">
                      {d.cardCount} card{d.cardCount === 1 ? "" : "s"} · {audience(d, profiles)}
                    </span>
                  </div>
                  <label className="check" title={d.enabled ? "Switch off to hide from kids" : "Switch on"}>
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => toggle(d, e.target.checked)}
                      aria-label={`Show "${d.title}" to kids`}
                    />
                    <span aria-hidden="true">On</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setEditing(d.id)}
                    aria-label={`Edit "${d.title}"`}
                  >
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

