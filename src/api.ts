// Browser client for the Vercel Functions in /api.

export interface SessionInfo {
  name: string;
  /** Points earned during this session. */
  points: number;
  /** Local clock time (ms) when the session ends. */
  deadline: number;
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

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
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
}

// Use the server's "seconds left" so a wrong device clock doesn't matter.
const toSession = (s: SessionResponse): SessionInfo => ({
  name: s.name,
  points: s.points,
  deadline: Date.now() + s.secondsLeft * 1000,
});

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
};
