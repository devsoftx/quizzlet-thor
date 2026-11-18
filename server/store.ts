import { Redis } from "@upstash/redis";
import { POINTS_PER_CORRECT, scoreRound, STREAK_BONUS, STREAK_THRESHOLD } from "../src/points.js";

export const SESSION_TTL_SECONDS = 60 * 60;

/**
 * How fast a session may answer: a burst, then one answer every few seconds
 * counted from the session's start. A whole hour allows 20 + 1,800 answers.
 */
export const PACE_BURST = 20;
export const PACE_MS_PER_ANSWER = 2000;

/** A guest nickname stays with the browser that used it for this long after its last session. */
export const GUEST_NAME_DAYS = 30;
const GUEST_NAME_MS = GUEST_NAME_DAYS * 24 * 60 * 60 * 1000;

export interface Session {
  id: string;
  name: string;
  /** Leaderboard identity: a guest's lowercased name, or "p:<profileId>" for a kid profile. */
  playerKey: string;
  expiresAt: number; // epoch ms
  points: number; // earned during this session
  /** Set when the session belongs to a kid profile (started by a parent or a linked device). */
  profileId?: string;
  /** Only sessions started from a linked device carry this binding. */
  linkedDeviceId?: string;
  linkedAccountId?: string;
  accountId?: string;
  /** False when the parent keeps this profile off the public leaderboard. Guests are always listed. */
  listed?: boolean;
  /** A kid profile's emoji, shown beside its name on the leaderboard (guests have none). */
  emoji?: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  /** Only kid profiles have one, so a guest can't pass as a kid with the same nickname. */
  emoji?: string;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  /** The requesting student's own entry, when they have points. */
  you: LeaderboardEntry | null;
}

/** One save from the browser: the answers, and an id so a retry is counted once. */
export interface ScoreBatch {
  id: string;
  /** What the browser sent, hashed: the same id with different contents is a conflict. */
  fingerprint: string;
  answers: readonly boolean[];
  /**
   * The streak the browser believes it is on. The store keeps the real one and
   * only ever lowers it to this (a new round starts from 0); it is never raised.
   */
  streakBefore?: number;
}

export interface ScoreReceipt {
  pointsEarned: number;
  sessionPoints: number;
  totalPoints: number;
  /** True when this batch had been saved before and the original receipt was returned. */
  replay: boolean;
}

export interface Store {
  createSession(session: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  /**
   * Scores a batch and adds it to the session and the student's total, in one
   * step. The streak and the answer count live in the session, so points don't
   * depend on what the browser claims. "limited": more answers than the
   * session's age allows (nothing is saved; the same batch can be sent later).
   */
  addScoreBatch(session: Session, batch: ScoreBatch, now: number): Promise<ScoreReceipt | "conflict" | "expired" | "limited">;
  leaderboard(limit: number, playerKey?: string): Promise<Leaderboard>;
  /** Updates a player's display name (and emoji) and whether they appear on the leaderboard. */
  syncPlayer(playerKey: string, name: string, listed: boolean, emoji?: string): Promise<void>;
  /**
   * Removes a player's name, total and leaderboard entry (profile or account
   * deleted, or an operator's removal). The key stays marked as hidden, so a
   * late write can never put it back on the public leaderboard.
   */
  removePlayer(playerKey: string): Promise<void>;
  /** All-time totals for kid profiles ("p:<id>" keys), whether or not they're on the leaderboard. */
  totalsFor(playerKeys: string[]): Promise<Record<string, number>>;
  /**
   * A guest nickname belongs to the first browser that uses it (`ownerHash` is
   * a fingerprint of that browser's cookie). False when another browser holds it.
   */
  claimGuestName(playerKey: string, ownerHash: string, now: number): Promise<boolean>;
  /** Keeps the `keep` highest guest entries and removes the rest. Kid profiles are never touched. */
  pruneGuests(keep: number): Promise<{ removed: number }>;
}

const isProfileKey = (playerKey: string) => playerKey.startsWith("p:");

/** Highest points first; equal points in reverse key order, the way Redis ranks a sorted set read from the top. */
const byRank = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0);

/** How many answers a session may have given by `now`. */
export function answersAllowed(expiresAt: number, now: number): number {
  const elapsed = Math.max(0, now - (expiresAt - SESSION_TTL_SECONDS * 1000));
  return PACE_BURST + Math.floor(elapsed / PACE_MS_PER_ANSWER);
}

// ---------------------------------------------------------------- Memory
// For local development and tests only: Vercel Functions don't share memory
// between instances, so production must use Redis.

type StoredSession = Session & { streak: number; answered: number };

interface MemoryState {
  sessions: Map<string, StoredSession>;
  totals: Map<string, number>;
  names: Map<string, string>;
  emojis: Map<string, string>;
  /** Players kept off the leaderboard (their totals still count), and removed players. */
  hidden: Set<string>;
  /** Guest playerKey -> the browser that holds the nickname. */
  owners: Map<string, { hash: string; expiresAt: number }>;
}

export class MemoryStore implements Store {
  private receipts = new Map<string, { fingerprint: string; receipt: Omit<ScoreReceipt, "replay">; expiresAt: number }>();
  constructor(
    private state: MemoryState = { sessions: new Map(), totals: new Map(), names: new Map(), emojis: new Map(), hidden: new Set(), owners: new Map() },
  ) {}

  async syncPlayer(playerKey: string, name: string, listed: boolean, emoji?: string) {
    this.state.names.set(playerKey, name);
    if (emoji) this.state.emojis.set(playerKey, emoji);
    if (listed) this.state.hidden.delete(playerKey);
    else this.state.hidden.add(playerKey);
  }

  async removePlayer(playerKey: string) {
    this.state.totals.delete(playerKey);
    this.state.names.delete(playerKey);
    this.state.emojis.delete(playerKey);
    this.state.owners.delete(playerKey);
    this.state.hidden.add(playerKey);
  }

  async totalsFor(playerKeys: string[]) {
    return Object.fromEntries(playerKeys.map((k) => [k, this.state.totals.get(k) ?? 0]));
  }

  async createSession(session: Session) {
    const { emoji, ...kept } = session; // the emoji belongs to the player, not the session
    this.state.sessions.set(session.id, { ...kept, streak: 0, answered: 0 });
    // A guest's name is only kept once they have points (see addScoreBatch).
    if (session.profileId) await this.syncPlayer(session.playerKey, session.name, session.listed !== false, emoji);
  }

  async getSession(id: string, now: number) {
    const session = this.state.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.state.sessions.delete(id);
      return null;
    }
    const { streak: _streak, answered: _answered, ...rest } = session;
    return { ...rest };
  }

  async deleteSession(id: string) {
    this.state.sessions.delete(id);
  }

  async addScoreBatch(session: Session, batch: ScoreBatch, now: number) {
    for (const [receiptKey, value] of this.receipts) if (value.expiresAt <= now) this.receipts.delete(receiptKey);
    const key = `${session.id}:${batch.id}`;
    const saved = this.receipts.get(key);
    if (saved) return saved.fingerprint === batch.fingerprint ? { ...saved.receipt, replay: true } : ("conflict" as const);

    const stored = this.state.sessions.get(session.id);
    if (!stored || stored.expiresAt <= now) return "expired" as const;
    const count = batch.answers.length;
    if (count > 0 && stored.answered + count > answersAllowed(stored.expiresAt, now)) return "limited" as const;

    // Mutate all state synchronously before yielding, so concurrent calls cannot interleave.
    const streakBefore = count > 0 && batch.streakBefore !== undefined ? Math.min(stored.streak, batch.streakBefore) : stored.streak;
    const round = scoreRound(batch.answers, streakBefore);
    stored.points += round.points;
    if (count > 0) {
      stored.streak = round.streak;
      stored.answered += count;
    }
    const playerKey = session.playerKey;
    let totalPoints: number;
    if (session.profileId) {
      totalPoints = (this.state.totals.get(playerKey) ?? 0) + round.points;
      this.state.totals.set(playerKey, totalPoints);
      this.state.names.set(playerKey, session.name); // visibility stays as the parent set it
    } else if (this.state.hidden.has(playerKey)) {
      totalPoints = stored.points; // a removed nickname earns session points only
    } else {
      totalPoints = (this.state.totals.get(playerKey) ?? 0) + round.points;
      if (round.points > 0) {
        this.state.totals.set(playerKey, totalPoints);
        this.state.names.set(playerKey, session.name);
      }
    }
    const receipt = { pointsEarned: round.points, sessionPoints: stored.points, totalPoints };
    this.receipts.set(key, { fingerprint: batch.fingerprint, receipt, expiresAt: session.expiresAt + 300_000 });
    return { ...receipt, replay: false };
  }

  async leaderboard(limit: number, playerKey?: string) {
    const ranked = [...this.state.totals.entries()]
      .filter(([key, points]) => points > 0 && !this.state.hidden.has(key))
      .sort(byRank)
      .map(([key, points], i) => ({ key, rank: i + 1, name: this.state.names.get(key) ?? key, points }));
    const strip = ({ key, rank, name, points }: (typeof ranked)[number]): LeaderboardEntry => {
      const emoji = isProfileKey(key) ? this.state.emojis.get(key) : undefined;
      return { rank, name, points, ...(emoji ? { emoji } : {}) };
    };
    const mine = playerKey ? ranked.find((e) => e.key === playerKey) : undefined;
    return { top: ranked.slice(0, limit).map(strip), you: mine ? strip(mine) : null };
  }

  async claimGuestName(playerKey: string, ownerHash: string, now: number) {
    const owner = this.state.owners.get(playerKey);
    if (owner && owner.expiresAt > now && owner.hash !== ownerHash) return false;
    this.state.owners.set(playerKey, { hash: ownerHash, expiresAt: now + GUEST_NAME_MS });
    return true;
  }

  async pruneGuests(keep: number) {
    const guests = [...this.state.totals.entries()].filter(([key]) => !isProfileKey(key)).sort(byRank);
    let removed = 0;
    for (const [key] of guests.slice(keep)) {
      this.state.totals.delete(key);
      this.state.names.delete(key);
      removed++;
    }
    // Names left behind without a score (older sessions that never earned points).
    for (const key of [...this.state.names.keys()]) {
      if (!isProfileKey(key) && !this.state.totals.has(key)) this.state.names.delete(key);
    }
    return { removed };
  }
}

// ----------------------------------------------------------------- Redis
// Keys:
//   session:<id>     hash {name, playerKey, expiresAt, points, streak, answered, profileId?, listed}, expires after 60 min
//   score-receipt:<session>:<batch>  the result of a saved batch, so a retry is counted once
//   leaderboard      sorted set: playerKey -> total points (listed players only)
//   player-names     hash: playerKey -> display name
//   player-emojis    hash: "p:<profileId>" -> the profile's emoji
//   leaderboard-hidden  set of players kept off the leaderboard: profiles the parent keeps private,
//                    and every removed player (deleted profile, operator removal)
//   player-totals    hash: "p:<profileId>" -> total points, kept even while a profile is unlisted
//                    (guests' totals live only in the leaderboard, as before)
//   guest-owner:<playerKey>  fingerprint of the browser that holds a guest nickname (30 days)

/**
 * Scores one batch atomically. The streak and the number of answers are kept
 * in the session hash; the browser can lower the streak (a new round) but not
 * raise it, and can't answer faster than the pace limit.
 * KEYS: session, receipt.
 * ARGV: 1 fingerprint, 2 answers ("1"/"0" per answer), 3 playerKey, 4 now (ms), 5 display name,
 *       6 "1" for a kid profile, 7 receipt expiry (ms), 8 the browser's streak ("" if none),
 *       9 points per correct answer, 10 streak bonus, 11 streak threshold,
 *       12 pace burst, 13 ms per answer, 14 session length (ms).
 */
export const SCORE_SCRIPT = `
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
    return {'ok', tostring(receipt.points or 0), tostring(receipt.sessionPoints), tostring(receipt.totalPoints), '1'}
  end
  local now = tonumber(ARGV[4])
  local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') or 0
  if redis.call('EXISTS', KEYS[1]) == 0 or expiresAt <= now then return {'expired'} end
  local isProfile = ARGV[6] == '1'
  local current = redis.call('HGET', KEYS[1], 'points') or '0'
  local total = isProfile and (redis.call('HGET', 'player-totals', ARGV[3]) or '0') or (redis.call('ZSCORE', 'leaderboard', ARGV[3]) or '0')
  if not tonumber(current) or not tonumber(total) or not string.match(current, '^%-?%d+$') or
     (isProfile and not string.match(total, '^%-?%d+$')) or
     math.abs(tonumber(current)) > 9000000000000000 or math.abs(tonumber(total)) > 9000000000000000 then return {'error'} end
  local count = string.len(ARGV[2])
  local answered = tonumber(redis.call('HGET', KEYS[1], 'answered') or '0') or 0
  local streak = tonumber(redis.call('HGET', KEYS[1], 'streak') or '0') or 0
  if count > 0 then
    local elapsed = now - (expiresAt - tonumber(ARGV[14]))
    if elapsed < 0 then elapsed = 0 end
    if answered + count > tonumber(ARGV[12]) + math.floor(elapsed / tonumber(ARGV[13])) then return {'limited'} end
    if ARGV[8] ~= '' and tonumber(ARGV[8]) < streak then streak = tonumber(ARGV[8]) end
  end
  local points = 0
  for i = 1, count do
    if string.sub(ARGV[2], i, i) == '1' then
      streak = streak + 1
      points = points + tonumber(ARGV[9])
      if streak >= tonumber(ARGV[11]) then points = points + tonumber(ARGV[10]) end
    else
      streak = 0
    end
  end
  local sessionPoints = redis.call('HINCRBY', KEYS[1], 'points', points)
  if count > 0 then redis.call('HSET', KEYS[1], 'streak', streak, 'answered', answered + count) end
  local hidden = redis.call('SISMEMBER', 'leaderboard-hidden', ARGV[3]) == 1
  local totalPoints
  if isProfile then
    totalPoints = redis.call('HINCRBY', 'player-totals', ARGV[3], points)
    redis.call('HSET', 'player-names', ARGV[3], ARGV[5])
    if not hidden and tonumber(totalPoints) > 0 then redis.call('ZADD', 'leaderboard', totalPoints, ARGV[3]) end
  elseif hidden then
    totalPoints = sessionPoints
  elseif points > 0 then
    totalPoints = redis.call('ZINCRBY', 'leaderboard', points, ARGV[3])
    redis.call('HSET', 'player-names', ARGV[3], ARGV[5])
  else
    totalPoints = total
  end
  redis.call('SET', KEYS[2], cjson.encode({fingerprint=ARGV[1],points=points,sessionPoints=tonumber(sessionPoints),totalPoints=tonumber(totalPoints)}))
  redis.call('PEXPIREAT', KEYS[2], ARGV[7])
  return {'ok', tostring(points), tostring(sessionPoints), tostring(totalPoints), '0'}
`;

/** ARGV: 1 owner fingerprint, 2 how long the claim lasts (ms). Returns 1 when this browser holds the name. */
export const CLAIM_SCRIPT = `
  local owner = redis.call('GET', KEYS[1])
  if owner and owner ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
`;

/**
 * Removes guest entries ranked below the top ARGV[1] guests, at most ARGV[2]
 * per call. Kid profiles ("p:" keys) are skipped, never removed.
 * Returns {removed, done}.
 */
export const PRUNE_SCRIPT = `
  local keep = tonumber(ARGV[1])
  local budget = tonumber(ARGV[2])
  local page = 500
  local guests = 0
  local index = 0
  local boundary = nil
  while boundary == nil do
    local members = redis.call('ZREVRANGE', 'leaderboard', index, index + page - 1)
    if #members == 0 then return {0, 1} end
    for i, member in ipairs(members) do
      if string.sub(member, 1, 2) ~= 'p:' then
        if guests == keep then boundary = index + i - 1; break end
        guests = guests + 1
      end
    end
    index = index + #members
  end
  local removed = 0
  index = boundary
  while removed < budget do
    local members = redis.call('ZREVRANGE', 'leaderboard', index, index + page - 1)
    if #members == 0 then return {removed, 1} end
    for _, member in ipairs(members) do
      if removed >= budget then break end
      if string.sub(member, 1, 2) == 'p:' then
        index = index + 1
      else
        redis.call('ZREM', 'leaderboard', member)
        redis.call('HDEL', 'player-names', member)
        removed = removed + 1
      end
    end
  end
  return {removed, 0}
`;

/**
 * One HSCAN step over player-names: drops guest names that have no leaderboard
 * score (left by sessions that never earned points). ARGV: 1 cursor.
 * Returns {next cursor, removed}.
 */
export const ORPHAN_NAMES_SCRIPT = `
  local step = redis.call('HSCAN', 'player-names', ARGV[1], 'COUNT', 500)
  local removed = 0
  for i = 1, #step[2], 2 do
    local member = step[2][i]
    if string.sub(member, 1, 2) ~= 'p:' and not redis.call('ZSCORE', 'leaderboard', member) then
      redis.call('HDEL', 'player-names', member)
      removed = removed + 1
    end
  end
  return {step[1], removed}
`;

const PRUNE_BUDGET = 2000;

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
        streak: 0,
        answered: 0,
        profileId: session.profileId ?? "",
        linkedDeviceId: session.linkedDeviceId ?? "",
        linkedAccountId: session.linkedAccountId ?? "",
        accountId: session.accountId ?? "",
        listed: session.listed === false ? 0 : 1,
      })
      .pexpireat(key, session.expiresAt)
      .exec();
    // A guest's name is only kept once they have points (see SCORE_SCRIPT).
    if (session.profileId) await this.syncPlayer(session.playerKey, session.name, session.listed !== false, session.emoji);
  }

  async syncPlayer(playerKey: string, name: string, listed: boolean, emoji?: string) {
    await this.redis.hset("player-names", { [playerKey]: name });
    if (emoji) await this.redis.hset("player-emojis", { [playerKey]: emoji });
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
      .sadd("leaderboard-hidden", playerKey) // stays behind as a marker
      .zrem("leaderboard", playerKey)
      .hdel("player-names", playerKey)
      .hdel("player-emojis", playerKey)
      .hdel("player-totals", playerKey)
      .del(`guest-owner:${playerKey}`)
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

  async addScoreBatch(session: Session, batch: ScoreBatch, now: number) {
    const result = await this.redis.eval<(string | number)[], (string | number)[]>(
      SCORE_SCRIPT,
      [`session:${session.id}`, `score-receipt:${session.id}:${batch.id}`],
      [
        batch.fingerprint,
        batch.answers.map((a) => (a ? "1" : "0")).join(""),
        session.playerKey,
        now,
        session.name,
        session.profileId ? "1" : "0",
        session.expiresAt + 300_000,
        batch.streakBefore ?? "",
        POINTS_PER_CORRECT,
        STREAK_BONUS,
        STREAK_THRESHOLD,
        PACE_BURST,
        PACE_MS_PER_ANSWER,
        SESSION_TTL_SECONDS * 1000,
      ],
    );
    if (result[0] === "conflict") return "conflict" as const;
    if (result[0] === "expired") return "expired" as const;
    if (result[0] === "limited") return "limited" as const;
    if (result[0] !== "ok") throw new Error("Score storage is unavailable or invalid.");
    return {
      pointsEarned: Number(result[1]),
      sessionPoints: Number(result[2]),
      totalPoints: Number(result[3]),
      replay: String(result[4]) === "1",
    };
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
    if (playerKey) {
      const [rank, score] = await Promise.all([
        this.redis.zrevrank("leaderboard", playerKey),
        this.redis.zscore("leaderboard", playerKey),
      ]);
      if (rank !== null && score !== null && Number(score) > 0) {
        const [name, emoji] = await Promise.all([
          this.redis.hget<string>("player-names", playerKey),
          isProfileKey(playerKey) ? this.redis.hget<string>("player-emojis", playerKey) : null,
        ]);
        you = { rank: rank + 1, name: String(name ?? playerKey), points: Number(score), ...(emoji ? { emoji: String(emoji) } : {}) };
      }
    }

    const profileKeys = keys.filter(isProfileKey);
    const [names, emojis] = await Promise.all([
      keys.length ? this.redis.hmget<Record<string, string>>("player-names", ...keys) : null,
      profileKeys.length ? this.redis.hmget<Record<string, string>>("player-emojis", ...profileKeys) : null,
    ]);
    const top = keys.map((key, i): LeaderboardEntry => {
      const emoji = emojis?.[key];
      return { rank: i + 1, name: String(names?.[key] ?? key), points: scores[i], ...(emoji ? { emoji: String(emoji) } : {}) };
    });
    return { top: top.filter((e) => e.points > 0), you };
  }

  async claimGuestName(playerKey: string, ownerHash: string, _now: number) {
    const held = await this.redis.eval<(string | number)[], number>(CLAIM_SCRIPT, [`guest-owner:${playerKey}`], [ownerHash, GUEST_NAME_MS]);
    return Number(held) === 1;
  }

  async pruneGuests(keep: number) {
    let removed = 0;
    // Bounded steps, so one long script never blocks the store.
    for (let step = 0; step < 500; step++) {
      const [count, done] = await this.redis.eval<number[], number[]>(PRUNE_SCRIPT, [], [keep, PRUNE_BUDGET]);
      removed += Number(count);
      if (Number(done) === 1) break;
    }
    let cursor = "0";
    for (let step = 0; step < 5000; step++) {
      const [next] = await this.redis.eval<string[], (string | number)[]>(ORPHAN_NAMES_SCRIPT, [], [cursor]);
      cursor = String(next);
      if (cursor === "0") break;
    }
    return { removed };
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
