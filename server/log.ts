// Security event log: one JSON line per event, read in the function logs.
//
// Rule: log ids and outcomes only. Never tokens, cookies, session ids (the
// session id *is* the cookie) or nicknames.

export type SecurityEvent =
  /** A parent route was called without a valid sign-in. */
  | "auth.failed"
  | "account.deleted"
  | "profile.deleted"
  | "invite.created"
  | "invite.redeemed"
  /** An invitation link that is unknown, used up, expired or over the device limit. */
  | "invite.refused"
  | "device.unlinked"
  /** A score save answered 409 or 429. */
  | "score.rejected"
  | "upload.refused"
  /** A state-changing request from another origin, or with a non-JSON body. */
  | "request.refused"
  | "rate_limit.exceeded"
  | "error.unhandled";

export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogEntry = LogFields & { event: SecurityEvent };
export type Logger = (entry: LogEntry) => void;

type Level = "info" | "warn" | "error";

const LEVELS: Partial<Record<SecurityEvent, Level>> = {
  "auth.failed": "warn",
  "invite.refused": "warn",
  "score.rejected": "warn",
  "upload.refused": "warn",
  "request.refused": "warn",
  "rate_limit.exceeded": "warn",
  "error.unhandled": "error",
};

/** Writes to stdout/stderr, where the platform collects function logs. */
export const consoleLogger: Logger = (entry) => {
  const level = LEVELS[entry.event] ?? "info";
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...entry });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export const noLog: Logger = () => undefined;
