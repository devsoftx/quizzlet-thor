import { useState, type FormEvent } from "react";
import { api } from "../api";
import {
  GRADE_BANDS,
  GRADE_LABELS,
  MAX_PROFILES,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  type KidProfile,
  type ProfileInput,
} from "../account-shared";
import { ProfileAvatar } from "./ParentHome";

interface Props {
  profiles: KidProfile[];
  onChange: (profiles: KidProfile[]) => void;
  onBack: () => void;
}

const BLANK: ProfileInput = {
  nickname: "",
  gradeBand: null,
  color: PROFILE_COLORS[0],
  emoji: PROFILE_EMOJIS[0],
  showOnLeaderboard: false,
};

function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: ProfileInput;
  submitLabel: string;
  onSubmit: (input: ProfileInput) => Promise<void>;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProfileInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProfileInput>) => setForm((f) => ({ ...f, ...patch }));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.nickname.trim()) run(() => onSubmit(form));
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="profile-form__preview">
        <ProfileAvatar profile={form} size={56} />
      </div>
      <label className="field">
        <span>Nickname</span>
        <input
          value={form.nickname}
          onChange={(e) => set({ nickname: e.target.value })}
          maxLength={24}
          autoComplete="off"
          placeholder="e.g. StarCat (not their real name)"
          required
        />
      </label>
      <label className="field">
        <span>Grade</span>
        <select
          value={form.gradeBand ?? ""}
          onChange={(e) => set({ gradeBand: (e.target.value || null) as ProfileInput["gradeBand"] })}
        >
          <option value="">Not set</option>
          {GRADE_BANDS.map((g) => (
            <option key={g} value={g}>
              {GRADE_LABELS[g]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>Color</legend>
        <div className="swatches">
          {PROFILE_COLORS.map((c) => (
            <label key={c} className="swatch" style={{ background: c }}>
              <input type="radio" name="color" checked={form.color === c} onChange={() => set({ color: c })} />
              <span className="visually-hidden">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Picture</legend>
        <div className="swatches">
          {PROFILE_EMOJIS.map((em) => (
            <label key={em} className="emoji-choice">
              <input type="radio" name="emoji" checked={form.emoji === em} onChange={() => set({ emoji: em })} />
              <span aria-hidden="true">{em}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={form.showOnLeaderboard}
          onChange={(e) => set({ showOnLeaderboard: e.target.checked })}
        />
        <span>
          Show on the public leaderboard <span className="muted">(nickname only)</span>
        </span>
      </label>
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !form.nickname.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete ${initial.nickname}'s profile? Their points will be removed.`)) run(onDelete);
            }}
          >
            Delete profile
          </button>
        )}
      </div>
    </form>
  );
}

export function ProfilesManager({ profiles, onChange, onBack }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(profiles.length === 0 ? "new" : null);

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
        <h1>Kid profiles</h1>
      </header>
      <p className="muted manage__intro">
        Each profile is just a nickname and a picture — no real names, emails or birthdays. Kids pick their profile on
        this device to study and earn points.
      </p>

      <ul className="manage__list">
        {profiles.map((p) => (
          <li key={p.id} className="manage__item">
            {editing === p.id ? (
              <ProfileForm
                initial={p}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  const updated = await api.updateProfile(p.id, input);
                  onChange(profiles.map((x) => (x.id === p.id ? updated : x)));
                  setEditing(null);
                }}
                onDelete={async () => {
                  await api.deleteProfile(p.id);
                  onChange(profiles.filter((x) => x.id !== p.id));
                  setEditing(null);
                }}
              />
            ) : (
              <div className="manage__row">
                <ProfileAvatar profile={p} size={44} />
                <div className="manage__info">
                  <strong>{p.nickname}</strong>
                  <span className="muted">
                    {p.gradeBand ? GRADE_LABELS[p.gradeBand] : "Grade not set"} ·{" "}
                    {p.showOnLeaderboard ? "On the leaderboard" : "Private"}
                  </span>
                </div>
                <button type="button" className="btn btn--secondary" onClick={() => setEditing(p.id)}>
                  Edit
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <div className="manage__item">
          <h2 className="section-title">New profile</h2>
          <ProfileForm
            initial={{
              ...BLANK,
              color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
              emoji: PROFILE_EMOJIS[profiles.length % PROFILE_EMOJIS.length],
            }}
            submitLabel="Create profile"
            onCancel={profiles.length > 0 ? () => setEditing(null) : undefined}
            onSubmit={async (input) => {
              const created = await api.createProfile(input);
              onChange([...profiles, created]);
              setEditing(null);
            }}
          />
        </div>
      ) : (
        profiles.length < MAX_PROFILES && (
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            + Add a profile
          </button>
        )
      )}
    </div>
  );
}
