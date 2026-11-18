// Browser client for the Vercel Functions in /api.
import type {
  AccountDeck,
  AccountFile,
  AccountSettings,
  DeckPatch,
  KidCard,
  KidDevice,
  KidInvite,
  KidProfile,
  ProfileInput,
} from "./account-shared";

export interface SessionInfo {
  name: string;
  /** Points earned during this session. */
  points: number;
  /** Local clock time (ms) when the session ends. */
  deadline: number;
  /** Set when the session belongs to a kid profile (started by a signed-in parent). */
  profileId: string | null;
  sessionTag?: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  /** Only parent-managed kid profiles have one; a guest's nickname never does. */
  emoji?: string;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  you: LeaderboardEntry | null;
}

export interface ScoreResult {
  pointsEarned: number;
  sessionPoints: number;
  totalPoints: number;
  leaderboard: Leaderboard;
}

/** One save while answering: the leaderboard comes only with a round's last save. */
export type ScoreSave = Omit<ScoreResult, "leaderboard"> & { leaderboard: Leaderboard | null };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Extra detail some routes send, e.g. what's wrong with a deck. */
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/** Set by the sign-in layer (src/auth.tsx): headers proving who the parent is. */
let authHeaders: () => Promise<Record<string, string>> = async () => ({});
export function setAuthHeaders(provider: () => Promise<Record<string, string>>) {
  authHeaders = provider;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; raw?: BodyInit; keepalive?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = await authHeaders().catch(() => ({}));
    if (init.body !== undefined) headers["content-type"] = "application/json";
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      // Lets a save finish even if the page is closing.
      keepalive: init.keepalive,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet connection.", 0);
  }
  const data = (await res.json().catch(() => null)) as { error?: string; errors?: unknown[] } | null;
  if (!res.ok) {
    const details = Array.isArray(data?.errors) ? data.errors.map(String) : [];
    throw new ApiError(data?.error ?? `Something went wrong (${res.status}).`, res.status, details);
  }
  return data as T;
}

interface SessionResponse {
  name: string;
  points: number;
  secondsLeft: number;
  profileId?: string | null;
  sessionTag?: string;
}

// Use the server's "seconds left" so a wrong device clock doesn't matter.
const toSession = (s: SessionResponse): SessionInfo => ({
  name: s.name,
  points: s.points,
  deadline: Date.now() + s.secondsLeft * 1000,
  profileId: s.profileId ?? null,
  sessionTag: s.sessionTag,
});

export interface AccountInfo {
  displayName: string;
  plan: "free" | "pro";
  settings: AccountSettings;
}

/** Private file storage: what's there, how much is used, and how uploads travel. */
export interface FilesInfo {
  files: AccountFile[];
  usage: { count: number; bytes: number };
  /** "blob": straight to Vercel Blob storage; "local": through /api/files (local dev). */
  uploadMode: "blob" | "local";
}

/** A parent's kid links: open invitations and linked devices. */
export interface KidLinks {
  invites: KidInvite[];
  devices: KidDevice[];
}

/** What a linked kid device sees: its profile and the parent's decks meant for it. */
export interface KidHomeInfo {
  profile: KidCard;
  decks: AccountDeck[];
  /** The kid's all-time points. */
  totalPoints: number;
}

const JOIN_PREFIX = "#join=";

/** The link a kid opens on their own device. The secret sits after "#", so browsers never send it to a server. */
export const inviteUrl = (token: string) => `${window.location.origin}/${JOIN_PREFIX}${token}`;

/** Reads an invitation token from the address bar and removes it from there (and from history). */
export function takeInviteToken(): string | null {
  const { hash, pathname, search } = window.location;
  if (!hash.startsWith(JOIN_PREFIX)) return null;
  window.history.replaceState(null, "", pathname + search);
  const token = hash.slice(JOIN_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

const profileUrl = (id: string) => `/api/profiles?id=${encodeURIComponent(id)}`;
const deckUrl = (id: string) => `/api/decks?id=${encodeURIComponent(id)}`;
const fileUrl = (id: string) => `/api/files?id=${encodeURIComponent(id)}`;

export const api = {
  /** The current session, or null if there isn't one. */
  async getSession(): Promise<SessionInfo | null> {
    const session = await call<SessionResponse | null>("/api/session");
    return session ? toSession(session) : null;
  },

  /** Check a private deck is still assigned to this learner before opening it. */
  async checkPrivateDeck(deckId: string): Promise<void> {
    await call(`/api/session?deckId=${encodeURIComponent(deckId)}`);
  },

  async startSession(name: string): Promise<SessionInfo> {
    return toSession(await call<SessionResponse>("/api/session", { method: "POST", body: { name } }));
  },

  async endSession(): Promise<void> {
    await call("/api/session", { method: "DELETE" });
  },

  /** The public leaderboard (no sign-in needed). */
  getLeaderboard(): Promise<Leaderboard> {
    return call<Leaderboard>("/api/leaderboard");
  },

  /**
   * Saves points for answers. The server keeps the streak itself: `streakBefore`
   * only tells it when a new round starts over from zero, so the points match
   * what the learner saw. Every save needs the session's tag and a batch id.
   */
  submitScore(
    answers: boolean[],
    options: { streakBefore: number; leaderboard: boolean; keepalive?: boolean; batchId?: string; deckId?: string; sessionTag?: string },
  ): Promise<ScoreSave> {
    if (!options.sessionTag) return Promise.reject(new ApiError("This session cannot safely save points. Refresh and start a new session.", 409));
    return call<ScoreSave>("/api/score", {
      method: "POST",
      body: { answers, streakBefore: options.streakBefore, leaderboard: options.leaderboard, batchId: options.batchId, deckId: options.deckId, sessionTag: options.sessionTag },
      keepalive: options.keepalive,
    });
  },

  // ---- Parent/teacher accounts (need a sign-in) ----

  /** The account (created on first sign-in), its kid profiles and each kid's all-time points. */
  getMe(): Promise<{ account: AccountInfo; profiles: KidProfile[]; points: Record<string, number> }> {
    return call("/api/me");
  },

  async updateMe(patch: { displayName?: string; settings?: Partial<AccountSettings> }): Promise<AccountInfo> {
    return (await call<{ account: AccountInfo }>("/api/me", { method: "PATCH", body: patch })).account;
  },

  async deleteMe(): Promise<void> {
    await call("/api/me", { method: "DELETE", body: { confirm: true } });
  },

  async createProfile(input: Partial<ProfileInput> & { nickname: string }): Promise<KidProfile> {
    return (await call<{ profile: KidProfile }>("/api/profiles", { method: "POST", body: input })).profile;
  },

  async updateProfile(id: string, patch: Partial<ProfileInput>): Promise<KidProfile> {
    return (await call<{ profile: KidProfile }>(profileUrl(id), { method: "PATCH", body: patch })).profile;
  },

  async deleteProfile(id: string): Promise<void> {
    await call(profileUrl(id), { method: "DELETE" });
  },

  /** A signed-in parent starts a 60-minute session for one of their kid profiles. */
  async startProfileSession(profileId: string): Promise<SessionInfo> {
    return toSession(await call<SessionResponse>("/api/session", { method: "POST", body: { profileId } }));
  },

  // ---- Kid device links (parent side) ----

  listLinks(): Promise<KidLinks> {
    return call("/api/invites");
  },

  /** A new one-time invitation link for a kid (any earlier link stops working). */
  async createInvite(profileId: string): Promise<{ url: string; invite: KidInvite }> {
    const { token, invite } = await call<{ token: string; invite: KidInvite }>("/api/invites", {
      method: "POST",
      body: { profileId },
    });
    return { url: inviteUrl(token), invite };
  },

  async cancelInvite(profileId: string): Promise<void> {
    await call(`/api/invites?profileId=${encodeURIComponent(profileId)}`, { method: "DELETE" });
  },

  async removeDevice(deviceId: string): Promise<void> {
    await call(`/api/invites?deviceId=${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  },

  // ---- A kid's own linked device (no account) ----

  /** The kid profile this device is linked to, or null. */
  async kidHome(): Promise<KidHomeInfo | null> {
    return (await call<{ kid: KidHomeInfo | null }>("/api/kid")).kid;
  },

  /** Whose invitation this is, before joining. */
  peekInvite(token: string): Promise<{ profile: KidCard; expiresAt: string }> {
    return call("/api/kid", { method: "POST", body: { action: "peek", token } });
  },

  /** Uses up the invitation and links this device to the kid's profile. */
  async joinInvite(token: string): Promise<KidCard> {
    return (await call<{ profile: KidCard }>("/api/kid", { method: "POST", body: { action: "join", token } })).profile;
  },

  async unlinkThisDevice(): Promise<void> {
    await call("/api/kid", { method: "DELETE" });
  },

  async startKidSession(): Promise<SessionInfo> {
    return toSession(await call<SessionResponse>("/api/session", { method: "POST", body: { kid: true } }));
  },

  // ---- Private decks ----

  async listDecks(): Promise<AccountDeck[]> {
    return (await call<{ decks: AccountDeck[] }>("/api/decks")).decks;
  },

  /** Saves a deck (YAML text) to the account; `profileIds` null means every kid sees it. */
  async createDeck(fileName: string, yaml: string, profileIds: string[] | null = null): Promise<AccountDeck> {
    return (await call<{ deck: AccountDeck }>("/api/decks", { method: "POST", body: { fileName, yaml, profileIds } })).deck;
  },

  async updateDeck(id: string, patch: DeckPatch): Promise<AccountDeck> {
    return (await call<{ deck: AccountDeck }>(deckUrl(id), { method: "PATCH", body: patch })).deck;
  },

  async deleteDeck(id: string): Promise<void> {
    await call(deckUrl(id), { method: "DELETE" });
  },

  // ---- Private files ----

  listFiles(): Promise<FilesInfo> {
    return call("/api/files");
  },

  /** Uploads a file to private storage and records it. */
  async uploadFile(file: File, onProgress?: (percent: number) => void): Promise<AccountFile> {
    const start = await call<{ pathname: string; contentType: string; uploadMode: FilesInfo["uploadMode"] }>(
      "/api/files?action=start",
      { method: "POST", body: { name: file.name, size: file.size } },
    );
    if (start.uploadMode === "blob") {
      // Loaded only when needed. The server signs an upload URL for this one path.
      const { uploadPresigned } = await import("@vercel/blob/client");
      try {
        await uploadPresigned(start.pathname, file, {
          access: "private",
          handleUploadUrl: "/api/files?action=sign",
          headers: await authHeaders().catch(() => ({})),
          contentType: start.contentType,
          multipart: false,
          onUploadProgress: onProgress ? ({ percentage }) => onProgress(percentage) : undefined,
        });
      } catch {
        throw new ApiError("The upload didn't go through. Please try again.", 0);
      }
    } else {
      await call(`/api/files?pathname=${encodeURIComponent(start.pathname)}`, { method: "PUT", raw: file });
      onProgress?.(100);
    }
    return (await call<{ file: AccountFile }>("/api/files?action=confirm", {
      method: "POST",
      body: { pathname: start.pathname, name: file.name },
    })).file;
  },

  /** A short-lived link to open a file (Blob storage). */
  async fileLink(id: string): Promise<string> {
    return (await call<{ url: string }>(fileUrl(id))).url;
  },

  /** The file's bytes (local dev, where there are no direct links). */
  async fileBytes(id: string): Promise<Blob> {
    const headers = await authHeaders().catch(() => ({}));
    const res = await fetch(`${fileUrl(id)}&raw=1`, { headers }).catch(() => null);
    if (!res?.ok) throw new ApiError("Couldn't open that file.", res?.status ?? 0);
    return res.blob();
  },

  async deleteFile(id: string): Promise<void> {
    await call(fileUrl(id), { method: "DELETE" });
  },
};
