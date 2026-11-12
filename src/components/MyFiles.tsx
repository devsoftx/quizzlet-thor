import { useEffect, useRef, useState } from "react";
import {
  FILE_ACCEPT,
  FILE_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_FILE_BYTES,
  type AccountFile,
} from "../account-shared";
import { api, type FilesInfo } from "../api";

interface Props {
  onBack: () => void;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

const icon = (type: string) => (type === "application/pdf" ? "📄" : type.startsWith("image/") ? "🖼️" : "📝");
const label = (type: string) => FILE_TYPES[type as keyof typeof FILE_TYPES]?.label ?? "File";
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A parent's private files (study material): upload, open, delete. */
export function MyFiles({ onBack }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<FilesInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    api
      .listFiles()
      .then(setInfo)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  async function upload(list: FileList | null) {
    if (!info) return;
    const files = Array.from(list ?? []);
    const failed: string[] = [];
    let current = info;
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      try {
        const saved = await api.uploadFile(file, (pct) => setBusy(`Uploading ${file.name}… ${Math.round(pct)}%`));
        current = {
          ...current,
          files: [...current.files, saved],
          usage: { count: current.usage.count + 1, bytes: current.usage.bytes + saved.size },
        };
        setInfo(current);
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : "Couldn't upload this file."}`);
      }
    }
    setErrors(failed);
    setBusy(null);
  }

  async function open(file: AccountFile) {
    setErrors([]);
    if (info?.uploadMode === "local") {
      try {
        saveBlob(await api.fileBytes(file.id), file.name);
      } catch (err) {
        setErrors([err instanceof Error ? err.message : "Couldn't open that file."]);
      }
      return;
    }
    // Open the tab during the click (so it isn't blocked), then point it at the short-lived link.
    const tab = window.open("", "_blank");
    try {
      const url = await api.fileLink(file.id);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      setErrors([err instanceof Error ? err.message : "Couldn't open that file."]);
    }
  }

  async function remove(file: AccountFile) {
    if (!info || !window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;
    setErrors([]);
    try {
      await api.deleteFile(file.id);
      setInfo({
        ...info,
        files: info.files.filter((f) => f.id !== file.id),
        usage: { count: info.usage.count - 1, bytes: info.usage.bytes - file.size },
      });
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Couldn't delete that file."]);
    }
  }

  const full = info ? info.usage.count >= MAX_FILES || info.usage.bytes >= MAX_TOTAL_FILE_BYTES : true;

  return (
    <div className="manage">
      <header className="manage__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
        <h1>My files</h1>
      </header>
      <p className="muted manage__intro">
        Keep study material here: PDFs, Word documents (.docx) and pictures, up to {formatBytes(MAX_FILE_BYTES)} each.
        Files are private: only you can open them, through your sign-in.
      </p>

      {loadError ? (
        <p className="welcome__error" role="alert">
          Couldn't load your files: {loadError}
        </p>
      ) : !info ? (
        <p className="muted loading">Loading…</p>
      ) : (
        <>
          <div className="manage__toolbar">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null || full}
            >
              + Upload a file…
            </button>
            <span className="muted manage__count">
              {info.usage.count} of {MAX_FILES} files · {formatBytes(info.usage.bytes)} of {formatBytes(MAX_TOTAL_FILE_BYTES)}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {busy && (
            <p className="muted" role="status">
              {busy}
            </p>
          )}
          {errors.length > 0 && (
            <div className="welcome__error upload-problems" role="alert">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}

          {info.files.length === 0 ? (
            <div className="empty">
              <p>No files yet.</p>
              <p className="muted">Upload worksheets, study guides or photos of notes to keep them in one place.</p>
            </div>
          ) : (
            <ul className="manage__list">
              {info.files.map((f) => (
                <li key={f.id} className="manage__item">
                  <div className="manage__row manage__row--wrap">
                    <span className="file-icon" aria-hidden="true">
                      {icon(f.contentType)}
                    </span>
                    <div className="manage__info">
                      <strong className="file-name">{f.name}</strong>
                      <span className="muted">
                        {label(f.contentType)} · {formatBytes(f.size)} · {date(f.createdAt)}
                      </span>
                    </div>
                    <button type="button" className="btn btn--secondary" onClick={() => open(f)} aria-label={`Open ${f.name}`}>
                      Open
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
