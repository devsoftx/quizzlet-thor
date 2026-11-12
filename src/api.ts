import type { AccountSettings, KidProfile, ProfileInput } from "./account-shared";
// Browser client for the Vercel Functions in /api.

export interface SessionInfo {
  name: string;
  /** Points earned during this session. */
  points: number;
  /** Local clock time (ms) when the session ends. */
  deadline: number;
  /** Set when the session belongs to a kid profile (started by a signed-in parent). */
  profileId: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Set by the sign-in layer (src/auth.tsx): headers proving who the parent is. */
let authHeaders: () => Promise<Record<string, string>> = async () => ({});
export function setAuthHeaders(provider: () => Promise<Record<string, string>>) {
  authHeaders = provider;
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = await authHeaders().catch(() => ({}));
    if (init.body !== undefined) headers["content-type"] = "application/json";
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet connection.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Something went wrong (${res.status}).`, res.status);
  }
  return data as T;
}

interface SessionResponse {
  name: string;
  points: number;
  secondsLeft: number;
  profileId?: string | null;
}

// Use the server's "seconds left" so a wrong device clock doesn't matter.
const toSession = (s: SessionResponse): SessionInfo => ({
  name: s.name,
  points: s.points,
  deadline: Date.now() + s.secondsLeft * 1000,
  profileId: s.profileId ?? null,
});

export interface AccountInfo {
  displayName: string;
  plan: "free" | "pro";
  settings: AccountSettings;
}

const profileUrl = (id: string) => `/api/profiles?id=${encodeURIComponent(id)}`;

export const api = {
  /** The current session, or null if there isn't one. */
  async getSession(): Promise<SessionInfo | null> {
    try {
      return toSession(await call<SessionResponse>("/api/session"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },

  async startSession(name: string): Promise<SessionInfo> {
    return toSession(await call<SessionResponse>("/api/session", { method: "POST", body: { name } }));
  },

  async endSession(): Promise<void> {
    await call("/api/session", { method: "DELETE" });
  },

  submitScore(answers: boolean[]): Promise<ScoreResult> {
    return call<ScoreResult>("/api/score", { method: "POST", body: { answers } });
  },

  // ---- Parent/teacher accounts (need a sign-in) ----

  /** The account (created on first sign-in) and its kid profiles. */
  getMe(): Promise<{ account: AccountInfo; profiles: KidProfile[] }> {
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
};
