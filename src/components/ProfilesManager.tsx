import { useEffect, useState, type FormEvent } from "react";
import { api, type KidLinks } from "../api";
import { KidLinkPanel } from "./KidLinks";
import {
  GRADE_BANDS,
  MAX_PROFILES,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  type KidProfile,
  type ProfileInput,
} from "../account-shared";
import { useI18n, type Messages } from "../i18n";
import { ProfileAvatar } from "./ParentHome";

interface Props {
  profiles: KidProfile[];
  /** Each kid's all-time points, by profile id. */
  points: Record<string, number>;
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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t.common.somethingWentWrong);
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
        <span>{t.profiles.nickname}</span>
        <input
          value={form.nickname}
          onChange={(e) => set({ nickname: e.target.value })}
          maxLength={24}
          autoComplete="off"
          placeholder={t.profiles.nicknamePlaceholder}
          required
        />
      </label>
      <label className="field">
        <span>{t.profiles.grade}</span>
        <select
          value={form.gradeBand ?? ""}
          onChange={(e) => set({ gradeBand: (e.target.value || null) as ProfileInput["gradeBand"] })}
        >
          <option value="">{t.profiles.gradeNotSet}</option>
          {GRADE_BANDS.map((g) => (
            <option key={g} value={g}>
              {t.profiles.grades[g]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>{t.profiles.color}</legend>
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
        <legend>{t.profiles.picture}</legend>
        <div className="swatches">
          {PROFILE_EMOJIS.map((em) => (
            <label key={em} className="emoji-choice">
              <input type="radio" name="emoji" checked={form.emoji === em} onChange={() => set({ emoji: em })} />
              <span aria-hidden="true">{em}</span>
              <span className="visually-hidden">{em}</span>
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
          {t.profiles.showOnBoard} <span className="muted">{t.profiles.showOnBoardHint}</span>
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
            {t.common.cancel}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t.profiles.confirmDelete(initial.nickname))) run(onDelete);
            }}
          >
            {t.profiles.deleteProfile}
          </button>
        )}
      </div>
    </form>
  );
}

export function ProfilesManager({ profiles, points, onChange, onBack }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | "new" | null>(profiles.length === 0 ? "new" : null);
  const [links, setLinks] = useState<KidLinks>({ invites: [], devices: [] });
  const [linksError, setLinksError] = useState<string | null>(null);
  /** Which kid's devices panel is open. */
  const [open, setOpen] = useState<string | null>(null);
  /** A link just made (shown once; only its fingerprint is kept on the server). */
  const [fresh, setFresh] = useState<{ profileId: string; url: string } | null>(null);

  useEffect(() => {
    api
      .listLinks()
      .then(setLinks)
      .catch((err: Error) => setLinksError(err.message));
  }, []);

  async function newLink(profileId: string) {
    const { url, invite } = await api.createInvite(profileId);
    setLinks((l) => ({ ...l, invites: [...l.invites.filter((i) => i.profileId !== profileId), invite] }));
    setFresh({ profileId, url });
    setOpen(profileId);
  }

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          {t.common.back}
        </button>
        <h1>{t.profiles.title}</h1>
      </header>
      <p className="muted manage__intro">
        {t.profiles.intro}
      </p>
      {linksError && (
        <p className="welcome__error" role="alert">
          {t.profiles.linksFailed(linksError)}
        </p>
      )}

      <ul className="manage__list">
        {profiles.map((p) => (
          <li key={p.id} className="manage__item">
            {editing === p.id ? (
              <ProfileForm
                initial={p}
                submitLabel={t.common.save}
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  const updated = await api.updateProfile(p.id, input);
                  onChange(profiles.map((x) => (x.id === p.id ? updated : x)));
                  setEditing(null);
                }}
                onDelete={async () => {
                  await api.deleteProfile(p.id);
                  onChange(profiles.filter((x) => x.id !== p.id));
                  // Deleting a profile also unlinks its devices and cancels its link.
                  setLinks((l) => ({
                    invites: l.invites.filter((i) => i.profileId !== p.id),
                    devices: l.devices.filter((d) => d.profileId !== p.id),
                  }));
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <div className="manage__row manage__row--wrap">
                  <ProfileAvatar profile={p} size={44} />
                  <div className="manage__info">
                    <strong>{p.nickname}</strong>
                    <span className="muted">
                      {p.gradeBand ? t.profiles.grades[p.gradeBand] : t.profiles.noGrade} ·{" "}
                      ⭐ {t.common.pts(points[p.id] ?? 0)} · {p.showOnLeaderboard ? t.profiles.onBoard : t.common.private} ·{" "}
                      {devicesLabel(links, p.id, t)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    aria-expanded={open === p.id}
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                  >
                    {t.profiles.devices}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setEditing(p.id)} aria-label={t.profiles.editLabel(p.nickname)}>
                    {t.common.edit}
                  </button>
                </div>
                {open === p.id && (
                  <KidLinkPanel
                    profile={p}
                    invite={links.invites.find((i) => i.profileId === p.id) ?? null}
                    devices={links.devices.filter((d) => d.profileId === p.id)}
                    freshUrl={fresh?.profileId === p.id ? fresh.url : null}
                    onNewLink={() => newLink(p.id)}
                    onCancelLink={async () => {
                      await api.cancelInvite(p.id);
                      setLinks((l) => ({ ...l, invites: l.invites.filter((i) => i.profileId !== p.id) }));
                      setFresh((f) => (f?.profileId === p.id ? null : f));
                    }}
                    onRemoveDevice={async (device) => {
                      await api.removeDevice(device.id);
                      setLinks((l) => ({ ...l, devices: l.devices.filter((d) => d.id !== device.id) }));
                    }}
                  />
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <div className="manage__item">
          <h2 className="section-title">{t.profiles.newProfile}</h2>
          <ProfileForm
            initial={{
              ...BLANK,
              color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
              emoji: PROFILE_EMOJIS[profiles.length % PROFILE_EMOJIS.length],
            }}
            submitLabel={t.profiles.create}
            onCancel={profiles.length > 0 ? () => setEditing(null) : undefined}
            onSubmit={async (input) => {
              const created = await api.createProfile(input);
              onChange([...profiles, created]);
              setEditing(null);
              // Every new kid gets an invitation link right away, to open on their own device.
              await newLink(created.id).catch(() => setOpen(created.id));
            }}
          />
        </div>
      ) : (
        profiles.length < MAX_PROFILES && (
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            {t.profiles.add}
          </button>
        )
      )}
    </div>
  );
}

function devicesLabel(links: KidLinks, profileId: string, t: Messages): string {
  return t.profiles.deviceCount(links.devices.filter((d) => d.profileId === profileId).length);
}
