import { useState } from "react";
import type { KidDevice, KidInvite, KidProfile } from "../account-shared";
import { formatDate, useI18n, type Language, type Messages } from "../i18n";

const day = (iso: string, language: Language) => formatDate(iso, { month: "short", day: "numeric" }, language);

/** A device's name ("Android tablet · Chrome") in the app's language; product names stay as they are. */
const deviceName = (label: string, t: Messages) =>
  label
    .split(" · ")
    .map((part) => t.links.deviceWords[part] ?? part)
    .join(" · ");

interface Props {
  profile: KidProfile;
  invite: KidInvite | null;
  devices: KidDevice[];
  /** The link just made for this kid (it can only be shown right after it's made). */
  freshUrl: string | null;
  onNewLink: () => Promise<void>;
  onCancelLink: () => Promise<void>;
  onRemoveDevice: (device: KidDevice) => Promise<void>;
}

/** A kid's invitation link and linked devices, inside the Kid profiles screen. */
export function KidLinkPanel({ profile, invite, devices, freshUrl, onNewLink, onCancelLink, onRemoveDevice }: Props) {
  const { language, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

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

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t.links.copyFailed);
    }
  }

  return (
    <div className="link-panel">
      {freshUrl && invite ? (
        <div className="link-panel__fresh">
          <p>
            <strong>{t.links.sendTo(profile.nickname)}</strong> {t.links.sendHow(day(invite.expiresAt, language))}
          </p>
          <div className="link-panel__url">
            <input
              readOnly
              value={freshUrl}
              aria-label={t.links.linkFor(profile.nickname)}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn--primary" onClick={() => copy(freshUrl)}>
              {copied ? t.links.copied : t.links.copy}
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() =>
                  navigator.share({ title: "Quizzlet", text: t.links.shareText(profile.nickname), url: freshUrl }).catch(() => undefined)
                }
              >
                {t.links.share}
              </button>
            )}
          </div>
          <p className="muted field__hint">{t.links.warning(profile.nickname)}</p>
        </div>
      ) : invite ? (
        <p className="link-panel__waiting">
          <span className="muted">{t.links.waiting(day(invite.expiresAt, language))}</span>{" "}
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => run(onNewLink)}>
            {t.links.newLink}
          </button>
        </p>
      ) : (
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => run(onNewLink)}>
          {t.links.linkDevice}
        </button>
      )}

      {invite && (
        <button type="button" className="btn btn--ghost link-panel__cancel" disabled={busy} onClick={() => run(onCancelLink)}>
          {t.links.cancelLink}
        </button>
      )}

      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}

      <div className="link-panel__devices">
        <h3 className="link-panel__heading">{t.links.devicesOf(profile.nickname)}</h3>
        <p className="muted field__hint">{t.links.removeHint}</p>
        {devices.length === 0 ? (
          <p className="muted">{t.links.noDevices}</p>
        ) : (
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <span aria-hidden="true">📱 </span>
                  {deviceName(d.label, t)} <span className="muted">{t.links.deviceDates(day(d.createdAt, language), day(d.lastSeenAt, language), day(d.expiresAt, language))}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  aria-label={t.links.removeDeviceLabel(deviceName(d.label, t), profile.nickname)}
                  onClick={() => {
                    if (window.confirm(t.links.confirmRemove(deviceName(d.label, t), profile.nickname))) void run(() => onRemoveDevice(d));
                  }}
                >
                  {t.common.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
