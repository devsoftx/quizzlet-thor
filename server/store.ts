import { Redis } from "@upstash/redis";
import { POINTS_PER_CORRECT, scoreRound, STREAK_BONUS, STREAK_THRESHOLD } from "../src/points.js";
import { isLocalDev, type Env } from "./env.js";

export const SESSION_TTL_SECONDS = 60 * 60;

/**
 * Pace cap: a session may have saved at most one answer per PACE_MS_PER_ANSWER
 * of its age, plus PACE_BURST to start with. Nobody reads and answers faster
 * for long; a script claiming points has to wait like everyone else.
 */
export const PACE_MS_PER_ANSWER = 1500;
export const PACE_BURST = 20;

/** How many answers a session of this age may have saved in total. */
export const answersAllowed = (ageMs: number) => PACE_BURST + Math.floor(Math.max(0, ageMs) / PACE_MS_PER_ANSWER);

export interface Session {
  id: string;
  name: string;
  /** Leaderboard identity: a guest's lowercased name, or "p:<profileId>" for a kid profile. */
  playerKey: string;
  expiresAt: number; // epoch ms
  points: number; // earned during this session
  /** Correct answers in a row so far. Kept here, not taken from the browser. */
  streak?: number;
  /** Answers saved so far, for the pace cap. */
  answers?: number;
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

/** One save of answers. The same id is only ever credited once. */
export interface ScoreBatch {
  id: string;
  /** A hash of the request, to tell a retry from a different batch reusing the id. */
  fingerprint: string;
  answers: readonly boolean[];
  /**
   * The browser's own count of the streak before these answers. It can only
   * lower the streak kept in the session (a new round starts from 0), never raise it.
   */
  streakCap?: number;
}

export interface ScoreReceipt {
  pointsEarned: number;
  sessionPoints: number;
  totalPoints: number;
}

/** "conflict": the id was used for other answers. "too-fast": over the pace cap, nothing added. */
export type ScoreOutcome = ScoreReceipt | "conflict" | "expired" | "too-fast";

export interface Store {
  createSession(session: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  /**
   * Scores the answers with the session's own streak and adds the points to the
   * session and the student's total (shown on the leaderboard if listed), in one step.
   */
  addScoreBatch(session: Session, batch: ScoreBatch, now: number): Promise<ScoreOutcome>;
  /** Counts a request in a fixed time window (for rate limits): the count so far and when it resets. */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
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
  private receipts = new Map<string, ScoreReceipt & { fingerprint: string; expiresAt: number }>();
  private hits = new Map<string, { count: number; resetAt: number }>();
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
    // A guest's name is stored when they first earn points, not for every session started.
    if (session.profileId) await this.syncPlayer(session.playerKey, session.name, session.listed !== false);
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

  async addScoreBatch(session: Session, batch: ScoreBatch, now: number): Promise<ScoreOutcome> {
    for (const [receiptKey, value] of this.receipts) if (value.expiresAt <= now) this.receipts.delete(receiptKey);
    const key = `${session.id}:${batch.id}`;
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== batch.fingerprint) return "conflict";
      return { pointsEarned: receipt.pointsEarned, sessionPoints: receipt.sessionPoints, totalPoints: receipt.totalPoints };
    }
    const stored = this.state.sessions.get(session.id);
    if (!stored || stored.expiresAt <= now) return "expired";

    const count = batch.answers.length;
    const answered = stored.answers ?? 0;
    const age = now - (stored.expiresAt - SESSION_TTL_SECONDS * 1000);
    if (count > 0 && answered + count > answersAllowed(age)) return "too-fast";
    const round = scoreRound(batch.answers, Math.min(stored.streak ?? 0, batch.streakCap ?? Infinity));

    // Mutate all state synchronously before yielding, so concurrent calls cannot interleave.
    stored.points += round.points;
    if (count > 0) {
      stored.streak = round.streak;
      stored.answers = answered + count;
    }
    let totalPoints = this.state.totals.get(session.playerKey) ?? 0;
    if (round.points > 0) {
      totalPoints += round.points;
      this.state.totals.set(session.playerKey, totalPoints);
      this.state.names.set(session.playerKey, session.name);
      if (!session.profileId) this.state.hidden.delete(session.playerKey); // a profile's visibility stays as the parent set it
    }
    const result = { pointsEarned: round.points, sessionPoints: stored.points, totalPoints };
    // An empty batch only reads the totals: nothing to remember.
    if (count > 0) this.receipts.set(key, { fingerprint: batch.fingerprint, ...result, expiresAt: session.expiresAt + 300_000 });
    return result;
  }

  async hit(key: string, windowMs: number, now: number) {
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    const current = this.hits.get(key);
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.hits.set(key, fresh);
      return { ...fresh };
    }
    current.count++;
    return { ...current };
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
//   session:<id>     hash {name, playerKey, expiresAt, points, streak, answers, profileId?, listed}, expires after 60 min
//   leaderboard      sorted set: playerKey -> total points (listed players only)
//   player-names     hash: playerKey -> display name (written when points are first earned)
//   leaderboard-hidden  set of "p:<profileId>" the parent keeps off the leaderboard
//   player-totals    hash: "p:<profileId>" -> total points, kept even while a profile is unlisted
//                    (guests' totals live only in the leaderboard, as before)
//   score-receipt:<session>:<batch>  the result of a saved batch, kept a little longer than the session
//   rate:<bucket>:<ip fingerprint>   request counter for a rate limit, expires with its window

/**
 * Saves one batch of answers atomically: replay check, session expiry, pace
 * cap, scoring with the session's own streak, then the totals and the receipt.
 * KEYS: session, receipt. ARGV: 1 fingerprint, 2 answers as "1"/"0" characters,
 * 3 player key, 4 now, 5 name, 6 "1" for a kid profile, 7 receipt expiry,
 * 8 the browser's streak (-1: none), 9 session length in ms, 10 ms per answer,
 * 11 burst, 12 points per correct answer, 13 streak bonus, 14 streak threshold.
 */
const SCORE_SCRIPT = `
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
    return {'ok', tostring(receipt.pointsEarned or 0), tostring(receipt.sessionPoints), tostring(receipt.totalPoints)}
  end
  local now = tonumber(ARGV[4])
  local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') or 0
  if redis.call('EXISTS', KEYS[1]) == 0 or expiresAt <= now then return {'expired'} end

  local answers = ARGV[2]
  local count = string.len(answers)
  local answered = tonumber(redis.call('HGET', KEYS[1], 'answers') or '0') or 0
  local age = math.max(0, now - (expiresAt - tonumber(ARGV[9])))
  if count > 0 and answered + count > tonumber(ARGV[11]) + math.floor(age / tonumber(ARGV[10])) then return {'too-fast'} end

  local streak = tonumber(redis.call('HGET', KEYS[1], 'streak') or '0') or 0
  local cap = tonumber(ARGV[8])
  if cap >= 0 and cap < streak then streak = cap end
  local points = 0
  for i = 1, count do
    if string.sub(answers, i, i) == '1' then
      streak = streak + 1
      points = points + tonumber(ARGV[12])
      if streak >= tonumber(ARGV[14]) then points = points + tonumber(ARGV[13]) end
    else
      streak = 0
    end
  end

  local current = redis.call('HGET', KEYS[1], 'points') or '0'
  local total = ARGV[6] == '1' and (redis.call('HGET', 'player-totals', ARGV[3]) or '0') or (redis.call('ZSCORE', 'leaderboard', ARGV[3]) or '0')
  if not tonumber(current) or not tonumber(total) or not string.match(current, '^%-?%d+$') or
     (ARGV[6] == '1' and not string.match(total, '^%-?%d+$')) or
     math.abs(tonumber(current)) > 9000000000000000 or math.abs(tonumber(total)) > 9000000000000000 then return {'error'} end

  local sessionPoints = redis.call('HINCRBY', KEYS[1], 'points', points)
  if count > 0 then redis.call('HSET', KEYS[1], 'streak', streak, 'answers', answered + count) end
  local totalPoints = tonumber(total)
  if points > 0 then
    if ARGV[6] == '1' then
      totalPoints = redis.call('HINCRBY', 'player-totals', ARGV[3], points)
      if redis.call('SISMEMBER', 'leaderboard-hidden', ARGV[3]) == 0 then redis.call('ZADD', 'leaderboard', totalPoints, ARGV[3]) end
    else
      totalPoints = tonumber(redis.call('ZINCRBY', 'leaderboard', points, ARGV[3]))
    end
    redis.call('HSET', 'player-names', ARGV[3], ARGV[5])
  end
  if count > 0 then
    redis.call('SET', KEYS[2], cjson.encode({fingerprint=ARGV[1],pointsEarned=points,sessionPoints=tonumber(sessionPoints),totalPoints=tonumber(totalPoints)}))
    redis.call('PEXPIREAT', KEYS[2], ARGV[7])
  end
  return {'ok', tostring(points), tostring(sessionPoints), tostring(totalPoints)}
`;

/** Counts one request in a fixed window. KEYS: counter. ARGV: 1 window in ms. Returns {count, ms left}. */
const RATE_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  local left = redis.call('PTTL', KEYS[1])
  if count == 1 or left < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    left = tonumber(ARGV[1])
  end
  return {count, left}
`;

export class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async createSession(session: Session) {
    const key = `session:${session.id}`;
    // A guest's name goes into player-names when they first earn points (the
    // score script), so starting sessions can't grow that hash without limit.
    await this.redis
      .multi()
      .hset(key, {
        name: session.name,
        playerKey: session.playerKey,
        expiresAt: session.expiresAt,
        points: session.points,
        streak: 0,
        answers: 0,
        profileId: session.profileId ?? "",
        linkedDeviceId: session.linkedDeviceId ?? "",
        linkedAccountId: session.linkedAccountId ?? "",
        accountId: session.accountId ?? "",
        listed: session.listed === false ? 0 : 1,
      })
      .pexpireat(key, session.expiresAt)
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
      streak: Number(data.streak) || 0,
      answers: Number(data.answers) || 0,
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

  async addScoreBatch(session: Session, batch: ScoreBatch, now: number): Promise<ScoreOutcome> {
    const result = await this.redis.eval<(string | number)[], (string | number)[]>(
      SCORE_SCRIPT,
      [`session:${session.id}`, `score-receipt:${session.id}:${batch.id}`],
      [
        batch.fingerprint,
        batch.answers.map((correct) => (correct ? "1" : "0")).join(""),
        session.playerKey,
        now,
        session.name,
        session.profileId ? "1" : "0",
        session.expiresAt + 300_000,
        batch.streakCap ?? -1,
        SESSION_TTL_SECONDS * 1000,
        PACE_MS_PER_ANSWER,
        PACE_BURST,
        POINTS_PER_CORRECT,
        STREAK_BONUS,
        STREAK_THRESHOLD,
      ],
    );
    if (result[0] === "conflict" || result[0] === "expired" || result[0] === "too-fast") return result[0];
    if (result[0] !== "ok") throw new Error("Score storage is unavailable or invalid.");
    return { pointsEarned: Number(result[1]), sessionPoints: Number(result[2]), totalPoints: Number(result[3]) };
  }

  async hit(key: string, windowMs: number, now: number) {
    const [count, left] = await this.redis.eval<number[], number[]>(RATE_SCRIPT, [`rate:${key}`], [windowMs]);
    return { count: Number(count), resetAt: now + Number(left) };
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
 * Returns null anywhere else that has no Redis connected (a Vercel deployment
 * or any production build).
 */
export function getStore(env: Env = process.env): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new RedisStore(new Redis({ url, token }));
  if (!isLocalDev(env)) return null;
  // Survive Vite reloading this module during development.
  return (globalState.__quizzletMemoryStore ??= new MemoryStore());
}
