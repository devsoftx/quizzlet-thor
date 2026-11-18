import { useState } from "react";
import type { KidDevice, KidInvite, KidProfile } from "../account-shared";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
      setError("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <div className="link-panel">
      {freshUrl && invite ? (
        <div className="link-panel__fresh">
          <p>
            <strong>Send this link to {profile.nickname}.</strong> Open it on their own tablet or computer to link that
            device. It works once, until {day(invite.expiresAt)}.
          </p>
          <div className="link-panel__url">
            <input
              readOnly
              value={freshUrl}
              aria-label={`Invitation link for ${profile.nickname}`}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn--primary" onClick={() => copy(freshUrl)}>
              {copied ? "Copied!" : "Copy link"}
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() =>
                  navigator.share({ title: "Quizzlet", text: `Study as ${profile.nickname} on Quizzlet`, url: freshUrl }).catch(() => undefined)
                }
              >
                Share…
              </button>
            )}
          </div>
          <p className="muted field__hint">Anyone with this link can link a device as {profile.nickname}, so send it only to them.</p>
        </div>
      ) : invite ? (
        <p className="link-panel__waiting">
          <span className="muted">A link is waiting to be opened (until {day(invite.expiresAt)}).</span>{" "}
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => run(onNewLink)}>
            Make a new link
          </button>
        </p>
      ) : (
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => run(onNewLink)}>
          + Link a device
        </button>
      )}

      {invite && (
        <button type="button" className="btn btn--ghost link-panel__cancel" disabled={busy} onClick={() => run(onCancelLink)}>
          Cancel link
        </button>
      )}

      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}

      <div className="link-panel__devices">
        <h3 className="link-panel__heading">{profile.nickname}'s devices</h3>
        <p className="muted field__hint">Removing a device stops future access when it next connects. Content already downloaded cannot be recalled.</p>
        {devices.length === 0 ? (
          <p className="muted">No devices linked yet.</p>
        ) : (
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <span aria-hidden="true">📱 </span>
                  {d.label} <span className="muted">· linked {day(d.createdAt)} · last used {day(d.lastSeenAt)} · works until {day(d.expiresAt)}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  aria-label={`Remove ${d.label} from ${profile.nickname}'s devices`}
                  onClick={() => {
                    if (window.confirm(`Remove ${d.label}? It will stop studying as ${profile.nickname}.`)) run(() => onRemoveDevice(d));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
