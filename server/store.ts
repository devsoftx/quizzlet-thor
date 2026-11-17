import { Redis } from "@upstash/redis";

export const SESSION_TTL_SECONDS = 60 * 60;

export interface Session {
  id: string;
  name: string;
  /** Leaderboard identity: a guest's lowercased name, or "p:<profileId>" for a kid profile. */
  playerKey: string;
  expiresAt: number; // epoch ms
  points: number; // earned during this session
  /** Set when a signed-in parent started the session for one of their kid profiles. */
  profileId?: string;
  /** Only sessions started from a linked device carry this binding. */
  linkedDeviceId?: string;
  linkedAccountId?: string;
  accountId?: string;
  /** False when the parent keeps this profile off the public leaderboard. Guests are always listed. */
  listed?: boolean;
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
  /** Adds points to the session and the student's total (shown on the leaderboard if listed). */
  addPoints(session: Session, points: number): Promise<{ sessionPoints: number; totalPoints: number }>;
  addScoreBatch(session: Session, id: string, fingerprint: string, points: number, now: number): Promise<{ sessionPoints: number; totalPoints: number } | "conflict" | "expired">;
  leaderboard(limit: number, playerKey?: string): Promise<Leaderboard>;
  /** Updates a player's display name and whether they appear on the leaderboard. */
  syncPlayer(playerKey: string, name: string, listed: boolean): Promise<void>;
  /** Removes a player's name, total and leaderboard entry (profile or account deleted). */
  removePlayer(playerKey: string): Promise<void>;
  /** All-time totals for kid profiles ("p:<id>" keys), whether or not they're on the leaderboard. */
  totalsFor(playerKeys: string[]): Promise<Record<string, number>>;
}

// ---------------------------------------------------------------- Memory
// For local development and tests only: Vercel Functions don't share memory
// between instances, so production must use Redis.

interface MemoryState {
  sessions: Map<string, Session>;
  totals: Map<string, number>;
  names: Map<string, string>;
  /** Players kept off the leaderboard (their totals still count). */
  hidden: Set<string>;
}

export class MemoryStore implements Store {
  private receipts = new Map<string, { fingerprint: string; sessionPoints: number; totalPoints: number; expiresAt: number }>();
  constructor(
    private state: MemoryState = { sessions: new Map(), totals: new Map(), names: new Map(), hidden: new Set() },
  ) {}

  async syncPlayer(playerKey: string, name: string, listed: boolean) {
    this.state.names.set(playerKey, name);
    if (listed) this.state.hidden.delete(playerKey);
    else this.state.hidden.add(playerKey);
  }

  async removePlayer(playerKey: string) {
    this.state.totals.delete(playerKey);
    this.state.names.delete(playerKey);
    this.state.hidden.delete(playerKey);
  }

  async totalsFor(playerKeys: string[]) {
    return Object.fromEntries(playerKeys.map((k) => [k, this.state.totals.get(k) ?? 0]));
  }

  async createSession(session: Session) {
    this.state.sessions.set(session.id, { ...session });
    if (session.profileId) await this.syncPlayer(session.playerKey, session.name, session.listed !== false);
    else this.state.names.set(session.playerKey, session.name);
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
    if (session.profileId) this.state.names.set(session.playerKey, session.name); // visibility stays as the parent set it
    else await this.syncPlayer(session.playerKey, session.name, true);
    return { sessionPoints, totalPoints };
  }

  async addScoreBatch(session: Session, id: string, fingerprint: string, points: number, now: number) {
    for (const [receiptKey, value] of this.receipts) if (value.expiresAt <= now) this.receipts.delete(receiptKey);
    const key = `${session.id}:${id}`;
    const receipt = this.receipts.get(key);
    if (receipt && receipt.expiresAt > now) {
      return receipt.fingerprint === fingerprint ? { sessionPoints: receipt.sessionPoints, totalPoints: receipt.totalPoints } : "conflict" as const;
    }
    const stored = this.state.sessions.get(session.id);
    if (!stored || stored.expiresAt <= now) return "expired" as const;
    // Mutate all state synchronously before yielding, so concurrent calls cannot interleave.
    stored.points += points;
    const totalPoints = (this.state.totals.get(session.playerKey) ?? 0) + points;
    this.state.totals.set(session.playerKey, totalPoints);
    this.state.names.set(session.playerKey, session.name);
    if (!session.profileId) this.state.hidden.delete(session.playerKey);
    const result = { sessionPoints: stored.points, totalPoints };
    this.receipts.set(key, { fingerprint, ...result, expiresAt: session.expiresAt + 300_000 });
    return result;
  }

  async leaderboard(limit: number, playerKey?: string) {
    const ranked = [...this.state.totals.entries()]
      .filter(([key, points]) => points > 0 && !this.state.hidden.has(key))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, points], i) => ({ key, rank: i + 1, name: this.state.names.get(key) ?? key, points }));
    const strip = ({ rank, name, points }: (typeof ranked)[number]) => ({ rank, name, points });
    const mine = playerKey ? ranked.find((e) => e.key === playerKey) : undefined;
    return { top: ranked.slice(0, limit).map(strip), you: mine ? strip(mine) : null };
  }
}

// ----------------------------------------------------------------- Redis
// Keys:
//   session:<id>     hash {name, playerKey, expiresAt, points, profileId?, listed}, expires after 60 min
//   leaderboard      sorted set: playerKey -> total points (listed players only)
//   player-names     hash: playerKey -> display name
//   leaderboard-hidden  set of "p:<profileId>" the parent keeps off the leaderboard
//   player-totals    hash: "p:<profileId>" -> total points, kept even while a profile is unlisted
//                    (guests' totals live only in the leaderboard, as before)

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
        profileId: session.profileId ?? "",
        linkedDeviceId: session.linkedDeviceId ?? "",
        linkedAccountId: session.linkedAccountId ?? "",
        accountId: session.accountId ?? "",
        listed: session.listed === false ? 0 : 1,
      })
      .pexpireat(key, session.expiresAt)
      .hset("player-names", { [session.playerKey]: session.name })
      .exec();
    if (session.profileId) await this.syncPlayer(session.playerKey, session.name, session.listed !== false);
  }

  async syncPlayer(playerKey: string, name: string, listed: boolean) {
    await this.redis.hset("player-names", { [playerKey]: name });
    if (!listed) {
      await this.redis.multi().sadd("leaderboard-hidden", playerKey).zrem("leaderboard", playerKey).exec();
      return;
    }
    await this.redis.srem("leaderboard-hidden", playerKey);
    const total = Number((await this.redis.hget("player-totals", playerKey)) ?? 0);
    if (total > 0) await this.redis.zadd("leaderboard", { score: total, member: playerKey });
  }

  async removePlayer(playerKey: string) {
    await this.redis
      .multi()
      .zrem("leaderboard", playerKey)
      .hdel("player-names", playerKey)
      .hdel("player-totals", playerKey)
      .srem("leaderboard-hidden", playerKey)
      .exec();
  }

  async totalsFor(playerKeys: string[]) {
    if (playerKeys.length === 0) return {};
    const values = await this.redis.hmget<Record<string, number | string | null>>("player-totals", ...playerKeys);
    return Object.fromEntries(playerKeys.map((k) => [k, Number(values?.[k] ?? 0) || 0]));
  }

  async getSession(id: string, now: number) {
    const data = await this.redis.hgetall<Record<string, string | number>>(`session:${id}`);
    if (!data || !data.playerKey) return null;
    const expiresAt = Number(data.expiresAt);
    if (expiresAt <= now) return null;
    const profileId = data.profileId ? String(data.profileId) : undefined;
    return {
      id,
      name: String(data.name),
      playerKey: String(data.playerKey),
      expiresAt,
      points: Number(data.points) || 0,
      ...(profileId ? { profileId } : {}),
      ...(data.linkedDeviceId ? { linkedDeviceId: String(data.linkedDeviceId) } : {}),
      ...(data.linkedAccountId ? { linkedAccountId: String(data.linkedAccountId) } : {}),
      ...(data.accountId ? { accountId: String(data.accountId) } : {}),
      listed: String(data.listed ?? "1") !== "0",
    };
  }

  async deleteSession(id: string) {
    await this.redis.del(`session:${id}`);
  }

  async addPoints(session: Session, points: number) {
    if (session.profileId) {
      // Kid profiles keep a private total; the leaderboard mirrors it only when listed.
      const [sessionPoints, total] = await this.redis
        .multi()
        .hincrby(`session:${session.id}`, "points", points)
        .hincrby("player-totals", session.playerKey, points)
        .hset("player-names", { [session.playerKey]: session.name })
        .exec<[number, number, number]>();
      const totalPoints = Number(total);
      const hidden = await this.redis.sismember("leaderboard-hidden", session.playerKey);
      if (!hidden) {
        await this.redis.zadd("leaderboard", { score: totalPoints, member: session.playerKey });
      }
      return { sessionPoints: Number(sessionPoints), totalPoints };
    }

    // Guests: HINCRBY keeps the session's original expiry.
    const [sessionPoints, totalPoints] = await this.redis
      .multi()
      .hincrby(`session:${session.id}`, "points", points)
      .zincrby("leaderboard", points, session.playerKey)
      .hset("player-names", { [session.playerKey]: session.name })
      .exec<[number, number, number]>();
    return { sessionPoints: Number(sessionPoints), totalPoints: Number(totalPoints) };
  }

  async addScoreBatch(session: Session, id: string, fingerprint: string, points: number, now: number) {
    const script = `
      local function validType(key, expected)
        local t = redis.call('TYPE', key).ok
        return t == 'none' or t == expected
      end
      if not validType(KEYS[1], 'hash') or not validType(KEYS[2], 'string') or
         not validType('player-names', 'hash') or not validType('leaderboard', 'zset') or
         not validType('player-totals', 'hash') or not validType('leaderboard-hidden', 'set') then
        return {'error'}
      end
      local previous = redis.call('GET', KEYS[2])
      if previous then
        local receipt = cjson.decode(previous)
        if receipt.fingerprint ~= ARGV[1] then return {'conflict'} end
        return {'ok', tostring(receipt.sessionPoints), tostring(receipt.totalPoints)}
      end
      if redis.call('EXISTS', KEYS[1]) == 0 or tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[4]) then return {'expired'} end
      local current = redis.call('HGET', KEYS[1], 'points') or '0'
      local total = ARGV[6] == '1' and (redis.call('HGET', 'player-totals', ARGV[3]) or '0') or (redis.call('ZSCORE', 'leaderboard', ARGV[3]) or '0')
      if not tonumber(current) or not tonumber(total) or not string.match(current, '^%-?%d+$') or
         (ARGV[6] == '1' and not string.match(total, '^%-?%d+$')) or
         math.abs(tonumber(current)) > 9000000000000000 or math.abs(tonumber(total)) > 9000000000000000 then return {'error'} end
      local sessionPoints = redis.call('HINCRBY', KEYS[1], 'points', ARGV[2])
      local totalPoints
      if ARGV[6] == '1' then
        totalPoints = redis.call('HINCRBY', 'player-totals', ARGV[3], ARGV[2])
        if redis.call('SISMEMBER', 'leaderboard-hidden', ARGV[3]) == 0 then redis.call('ZADD', 'leaderboard', totalPoints, ARGV[3]) end
      else
        totalPoints = redis.call('ZINCRBY', 'leaderboard', ARGV[2], ARGV[3])
      end
      redis.call('HSET', 'player-names', ARGV[3], ARGV[5])
      redis.call('SET', KEYS[2], cjson.encode({fingerprint=ARGV[1],sessionPoints=tonumber(sessionPoints),totalPoints=tonumber(totalPoints)}))
      redis.call('PEXPIREAT', KEYS[2], ARGV[7])
      return {'ok', tostring(sessionPoints), tostring(totalPoints)}
    `;
    const result = await this.redis.eval<unknown[], (string | number)[]>(script, [`session:${session.id}`, `score-receipt:${session.id}:${id}`], [fingerprint, points, session.playerKey, now, session.name, session.profileId ? "1" : "0", session.expiresAt + 300_000]);
    if (result[0] === "conflict") return "conflict" as const;
    if (result[0] === "expired") return "expired" as const;
    if (result[0] !== "ok") throw new Error("Score storage is unavailable or invalid.");
    return { sessionPoints: Number(result[1]), totalPoints: Number(result[2]) };
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
