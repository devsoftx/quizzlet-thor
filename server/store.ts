import { Redis } from "@upstash/redis";

export const SESSION_TTL_SECONDS = 60 * 60;

export interface Session {
  id: string;
  name: string;
  /** Normalized name used as the leaderboard identity. */
  playerKey: string;
  expiresAt: number; // epoch ms
  points: number; // earned during this session
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  /** The requesting student's own entry, when they have points. */
  you: LeaderboardEntry | null;
}

export interface Store {
  createSession(session: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  /** Adds points to the session and the student's leaderboard total. */
  addPoints(session: Session, points: number): Promise<{ sessionPoints: number; totalPoints: number }>;
  leaderboard(limit: number, playerKey?: string): Promise<Leaderboard>;
}

// ---------------------------------------------------------------- Memory
// For local development and tests only: Vercel Functions don't share memory
// between instances, so production must use Redis.

interface MemoryState {
  sessions: Map<string, Session>;
  totals: Map<string, number>;
  names: Map<string, string>;
}

export class MemoryStore implements Store {
  constructor(private state: MemoryState = { sessions: new Map(), totals: new Map(), names: new Map() }) {}

  async createSession(session: Session) {
    this.state.sessions.set(session.id, { ...session });
    this.state.names.set(session.playerKey, session.name);
  }

  async getSession(id: string, now: number) {
    const session = this.state.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.state.sessions.delete(id);
      return null;
    }
    return { ...session };
  }

  async deleteSession(id: string) {
    this.state.sessions.delete(id);
  }

  async addPoints(session: Session, points: number) {
    const stored = this.state.sessions.get(session.id);
    const sessionPoints = (stored?.points ?? session.points) + points;
    if (stored) stored.points = sessionPoints;
    const totalPoints = (this.state.totals.get(session.playerKey) ?? 0) + points;
    this.state.totals.set(session.playerKey, totalPoints);
    this.state.names.set(session.playerKey, session.name);
    return { sessionPoints, totalPoints };
  }

  async leaderboard(limit: number, playerKey?: string) {
    const ranked = [...this.state.totals.entries()]
      .filter(([, points]) => points > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, points], i) => ({ key, rank: i + 1, name: this.state.names.get(key) ?? key, points }));
    const strip = ({ rank, name, points }: (typeof ranked)[number]) => ({ rank, name, points });
    const mine = playerKey ? ranked.find((e) => e.key === playerKey) : undefined;
    return { top: ranked.slice(0, limit).map(strip), you: mine ? strip(mine) : null };
  }
}

// ----------------------------------------------------------------- Redis
// Keys:
//   session:<id>     hash {name, playerKey, expiresAt, points}, expires after 60 min
//   leaderboard      sorted set: playerKey -> total points
//   player-names     hash: playerKey -> display name

export class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async createSession(session: Session) {
    const key = `session:${session.id}`;
    await this.redis
      .multi()
      .hset(key, {
        name: session.name,
        playerKey: session.playerKey,
        expiresAt: session.expiresAt,
        points: session.points,
      })
      .pexpireat(key, session.expiresAt)
      .hset("player-names", { [session.playerKey]: session.name })
      .exec();
  }

  async getSession(id: string, now: number) {
    const data = await this.redis.hgetall<Record<string, string | number>>(`session:${id}`);
    if (!data || !data.playerKey) return null;
    const expiresAt = Number(data.expiresAt);
    if (expiresAt <= now) return null;
    return {
      id,
      name: String(data.name),
      playerKey: String(data.playerKey),
      expiresAt,
      points: Number(data.points) || 0,
    };
  }

  async deleteSession(id: string) {
    await this.redis.del(`session:${id}`);
  }

  async addPoints(session: Session, points: number) {
    // HINCRBY keeps the session's original expiry.
    const [sessionPoints, totalPoints] = await this.redis
      .multi()
      .hincrby(`session:${session.id}`, "points", points)
      .zincrby("leaderboard", points, session.playerKey)
      .hset("player-names", { [session.playerKey]: session.name })
      .exec<[number, number, number]>();
    return { sessionPoints: Number(sessionPoints), totalPoints: Number(totalPoints) };
  }

  async leaderboard(limit: number, playerKey?: string) {
    const flat = await this.redis.zrange<(string | number)[]>("leaderboard", 0, limit - 1, {
      rev: true,
      withScores: true,
    });
    const keys: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      keys.push(String(flat[i]));
      scores.push(Number(flat[i + 1]));
    }

    let you: LeaderboardEntry | null = null;
    let yourName: string | null = null;
    if (playerKey) {
      const [rank, score] = await Promise.all([
        this.redis.zrevrank("leaderboard", playerKey),
        this.redis.zscore("leaderboard", playerKey),
      ]);
      if (rank !== null && score !== null) {
        yourName = await this.redis.hget<string>("player-names", playerKey);
        you = { rank: rank + 1, name: String(yourName ?? playerKey), points: Number(score) };
      }
    }

    const names = keys.length ? await this.redis.hmget<Record<string, string>>("player-names", ...keys) : null;
    const top = keys.map((key, i) => ({
      rank: i + 1,
      name: String(names?.[key] ?? key),
      points: scores[i],
    }));
    return { top: top.filter((e) => e.points > 0), you };
  }
}

// --------------------------------------------------------------- Factory

const globalState = globalThis as typeof globalThis & { __quizzletMemoryStore?: MemoryStore };

/**
 * Redis when Upstash credentials are present (Vercel's Upstash integration
 * provides KV_REST_API_*), otherwise an in-memory store for local dev.
 * Returns null on a Vercel deployment with no Redis connected.
 */
export function getStore(env: Record<string, string | undefined> = process.env): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new RedisStore(new Redis({ url, token }));
  if (env.VERCEL) return null;
  // Survive Vite reloading this module during development.
  return (globalState.__quizzletMemoryStore ??= new MemoryStore());
}
