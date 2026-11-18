import { Redis } from "@upstash/redis";
import { MAX_DEVICES_PER_PROFILE } from "../src/account-shared.js";
import { POINTS_PER_CORRECT, scoreRound, STREAK_BONUS, STREAK_THRESHOLD } from "../src/points.js";

export const SESSION_TTL_SECONDS = 60 * 60;

/**
 * How fast a session may answer: a burst, then one answer every few seconds
 * counted from the session's start. A whole hour allows 20 + 1,800 answers.
 */
export const PACE_BURST = 20;
export const PACE_MS_PER_ANSWER = 2000;
/**
 * The same limit also follows the player from session to session, so starting
 * a new session doesn't start a new allowance. A kid profile can be on several
 * linked devices at once, so its shared allowance is that many times larger.
 */
export const PROFILE_PACE_SCALE = MAX_DEVICES_PER_PROFILE;

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
   * depend on what the browser claims. "limited": more answers than the pace
   * limit allows, for this session or for this player across sessions
   * (nothing is saved; the same batch can be sent later).
   */
  addScoreBatch(session: Session, batch: ScoreBatch, now: number): Promise<ScoreReceipt | "conflict" | "expired" | "limited">;
  leaderboard(limit: number, playerKey?: string): Promise<Leaderboard>;
  /**
   * Updates a player's display name (and emoji) and whether they appear on the
   * leaderboard: the parent's choice, applied when the profile is saved.
   */
  syncPlayer(playerKey: string, name: string, listed: boolean, emoji?: string): Promise<void>;
  /**
   * Removes a player's name, total and leaderboard entry (profile or account
   * deleted, or an operator's removal). The key is remembered as removed: no
   * later score, session or visibility change puts it back on the leaderboard.
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

/** How many answers may have been given by `now`, counting from `startedAt`. */
export function answersAllowed(startedAt: number, now: number): number {
  return PACE_BURST + Math.floor(Math.max(0, now - startedAt) / PACE_MS_PER_ANSWER);
}

const startOf = (session: Pick<Session, "expiresAt">) => session.expiresAt - SESSION_TTL_SECONDS * 1000;

// ---------------------------------------------------------------- Memory
// For local development and tests only: Vercel Functions don't share memory
// between instances, so production must use Redis.

type StoredSession = Session & { streak: number; answered: number };

interface MemoryState {
  sessions: Map<string, StoredSession>;
  totals: Map<string, number>;
  names: Map<string, string>;
  emojis: Map<string, string>;
  /** Kid profiles their parent keeps off the leaderboard (their totals still count). */
  hidden: Set<string>;
  /** Players that were removed (deleted profile, operator's removal): never listed again. */
  removed: Set<string>;
  /** Guest playerKey -> the browser that holds the nickname. */
  owners: Map<string, { hash: string; expiresAt: number }>;
  /** playerKey -> answers given since `start`, across sessions (forgotten an hour after the last one). */
  pace: Map<string, { start: number; answered: number; expiresAt: number }>;
}

export class MemoryStore implements Store {
  private receipts = new Map<string, { fingerprint: string; receipt: Omit<ScoreReceipt, "replay">; expiresAt: number }>();
  constructor(
    private state: MemoryState = {
      sessions: new Map(),
      totals: new Map(),
      names: new Map(),
      emojis: new Map(),
      hidden: new Set(),
      removed: new Set(),
      owners: new Map(),
      pace: new Map(),
    },
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
    this.state.pace.delete(playerKey);
    this.state.hidden.delete(playerKey);
    this.state.removed.add(playerKey);
  }

  async totalsFor(playerKeys: string[]) {
    return Object.fromEntries(playerKeys.map((k) => [k, this.state.totals.get(k) ?? 0]));
  }

  async createSession(session: Session) {
    const { emoji, ...kept } = session; // the emoji belongs to the player, not the session
    this.state.sessions.set(session.id, { ...kept, streak: 0, answered: 0 });
    // A guest's name is only kept once they have points (see addScoreBatch).
    if (!session.profileId) return;
    this.state.names.set(session.playerKey, session.name);
    if (emoji) this.state.emojis.set(session.playerKey, emoji);
    // A session can hide a profile (its copy says "private") but never un-hide one: the copy may be
    // a moment out of date, and only the parent's saved choice (syncPlayer) makes a profile public.
    if (session.listed === false) this.state.hidden.add(session.playerKey);
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
    const playerKey = session.playerKey;
    let pace = this.state.pace.get(playerKey);
    if (!pace || pace.expiresAt <= now || pace.start > now) pace = { start: startOf(stored), answered: 0, expiresAt: 0 };
    if (count > 0) {
      if (stored.answered + count > answersAllowed(startOf(stored), now)) return "limited" as const;
      const scale = session.profileId ? PROFILE_PACE_SCALE : 1;
      if (pace.answered + count > scale * answersAllowed(pace.start, now)) return "limited" as const;
    }

    // Mutate all state synchronously before yielding, so concurrent calls cannot interleave.
    const streakBefore = count > 0 && batch.streakBefore !== undefined ? Math.min(stored.streak, batch.streakBefore) : stored.streak;
    const round = scoreRound(batch.answers, streakBefore);
    stored.points += round.points;
    if (count > 0) {
      stored.streak = round.streak;
      stored.answered += count;
      this.state.pace.set(playerKey, { start: pace.start, answered: pace.answered + count, expiresAt: now + SESSION_TTL_SECONDS * 1000 });
    }
    let totalPoints: number;
    if (session.profileId) {
      totalPoints = (this.state.totals.get(playerKey) ?? 0) + round.points;
      this.state.totals.set(playerKey, totalPoints);
      this.state.names.set(playerKey, session.name); // visibility stays as the parent set it
    } else if (this.state.removed.has(playerKey)) {
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
      .filter(([key, points]) => points > 0 && !this.state.hidden.has(key) && !this.state.removed.has(key))
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
//   leaderboard-hidden  set of "p:<profileId>" the parent keeps off the leaderboard
//   leaderboard-removed  set of removed players (deleted profile, operator's removal): never listed again
//   player-totals    hash: "p:<profileId>" -> total points, kept even while a profile is unlisted
//                    (guests' totals live only in the leaderboard, as before)
//   guest-owner:<playerKey>  fingerprint of the browser that holds a guest nickname (30 days)
//   pace:<playerKey> hash {start, answered}: the player's answers across sessions (an hour after the last)
//
// Reads that return names or player keys go through small scripts that answer
// in JSON. The Upstash client turns bare replies that look like JSON into
// numbers, booleans or null ("42.0" becomes 42), which would mix up players
// whose nicknames look like that; a JSON string comes back exactly as stored.

/**
 * Scores one batch atomically. The streak and the number of answers are kept
 * in the session hash; the browser can lower the streak (a new round) but not
 * raise it, and can't answer faster than the pace limit. The same limit is
 * kept per player (pace:<playerKey>), so a new session isn't a new allowance.
 * KEYS: session, receipt.
 * ARGV: 1 fingerprint, 2 answers ("1"/"0" per answer), 3 playerKey, 4 now (ms), 5 display name,
 *       6 "1" for a kid profile, 7 receipt expiry (ms), 8 the browser's streak ("" if none),
 *       9 points per correct answer, 10 streak bonus, 11 streak threshold,
 *       12 pace burst, 13 ms per answer, 14 session length (ms),
 *       15 how many times the limit a player may use across sessions (1 for guests).
 */
export const SCORE_SCRIPT = `
  local function validType(key, expected)
    local t = redis.call('TYPE', key).ok
    return t == 'none' or t == expected
  end
  if not validType(KEYS[1], 'hash') or not validType(KEYS[2], 'string') or
     not validType('player-names', 'hash') or not validType('leaderboard', 'zset') or
     not validType('player-totals', 'hash') or not validType('leaderboard-hidden', 'set') or
     not validType('leaderboard-removed', 'set') or not validType('pace:' .. ARGV[3], 'hash') then
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
  local sessionStart = expiresAt - tonumber(ARGV[14])
  local paceKey = 'pace:' .. ARGV[3]
  local paceStart = tonumber(redis.call('HGET', paceKey, 'start') or '')
  local paceAnswered = tonumber(redis.call('HGET', paceKey, 'answered') or '0') or 0
  if not paceStart or paceStart > now then
    paceStart = sessionStart
    paceAnswered = 0
  end
  if count > 0 then
    local function allowed(since)
      local elapsed = now - since
      if elapsed < 0 then elapsed = 0 end
      return tonumber(ARGV[12]) + math.floor(elapsed / tonumber(ARGV[13]))
    end
    if answered + count > allowed(sessionStart) then return {'limited'} end
    if paceAnswered + count > tonumber(ARGV[15]) * allowed(paceStart) then return {'limited'} end
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
  if count > 0 then
    redis.call('HSET', KEYS[1], 'streak', streak, 'answered', answered + count)
    redis.call('HSET', paceKey, 'start', paceStart, 'answered', paceAnswered + count)
    redis.call('PEXPIRE', paceKey, ARGV[14])
  end
  local hidden = redis.call('SISMEMBER', 'leaderboard-hidden', ARGV[3]) == 1 or
                 redis.call('SISMEMBER', 'leaderboard-removed', ARGV[3]) == 1
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

/** KEYS: session. The session's fields and values as one JSON array: [field, value, …], every value a string. */
export const SESSION_SCRIPT = `
  return cjson.encode(redis.call('HGETALL', KEYS[1]))
`;

/**
 * The top ARGV[1] entries, and the entry of player ARGV[2] ("" for none), as JSON:
 * {top: [{key, points, name, emoji}], you: {rank, points, name, emoji} | false}.
 * (A missing name or emoji is false; an empty `top` arrives as {}.)
 */
export const LEADERBOARD_SCRIPT = `
  local function entry(key, points)
    local e = { key = key, points = points, name = redis.call('HGET', 'player-names', key) }
    if string.sub(key, 1, 2) == 'p:' then e.emoji = redis.call('HGET', 'player-emojis', key) end
    return e
  end
  local flat = redis.call('ZREVRANGE', 'leaderboard', 0, tonumber(ARGV[1]) - 1, 'WITHSCORES')
  local top = {}
  for i = 1, #flat, 2 do top[#top + 1] = entry(flat[i], flat[i + 1]) end
  local you = false
  if ARGV[2] ~= '' then
    local rank = redis.call('ZREVRANK', 'leaderboard', ARGV[2])
    if rank then
      you = entry(ARGV[2], redis.call('ZSCORE', 'leaderboard', ARGV[2]))
      you.rank = rank
    end
  end
  return cjson.encode({ top = top, you = you })
`;

/**
 * Sets a player's name and emoji, and their place on the leaderboard, in one step.
 * ARGV: 1 playerKey, 2 name, 3 "list" | "hide" | "keep" (leave visibility as it is), 4 emoji ("" for none).
 * A removed player is never listed.
 */
export const SYNC_SCRIPT = `
  redis.call('HSET', 'player-names', ARGV[1], ARGV[2])
  if ARGV[4] ~= '' then redis.call('HSET', 'player-emojis', ARGV[1], ARGV[4]) end
  if ARGV[3] == 'hide' then
    redis.call('SADD', 'leaderboard-hidden', ARGV[1])
    redis.call('ZREM', 'leaderboard', ARGV[1])
  elseif ARGV[3] == 'list' then
    redis.call('SREM', 'leaderboard-hidden', ARGV[1])
    if redis.call('SISMEMBER', 'leaderboard-removed', ARGV[1]) == 0 then
      local total = tonumber(redis.call('HGET', 'player-totals', ARGV[1]) or '0') or 0
      if total > 0 then redis.call('ZADD', 'leaderboard', total, ARGV[1]) end
    end
  end
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
    // A session can hide a profile (its copy says "private") but never un-hide one: the copy may be
    // a moment out of date, and only the parent's saved choice (syncPlayer) makes a profile public.
    if (session.profileId) await this.sync(session.playerKey, session.name, session.listed === false ? "hide" : "keep", session.emoji);
  }

  private async sync(playerKey: string, name: string, mode: "list" | "hide" | "keep", emoji?: string) {
    await this.redis.eval<string[], number>(SYNC_SCRIPT, [], [playerKey, name, mode, emoji ?? ""]);
  }

  async syncPlayer(playerKey: string, name: string, listed: boolean, emoji?: string) {
    await this.sync(playerKey, name, listed ? "list" : "hide", emoji);
  }

  async removePlayer(playerKey: string) {
    await this.redis
      .multi()
      .sadd("leaderboard-removed", playerKey) // stays behind: this key is never listed again
      .srem("leaderboard-hidden", playerKey)
      .zrem("leaderboard", playerKey)
      .hdel("player-names", playerKey)
      .hdel("player-emojis", playerKey)
      .hdel("player-totals", playerKey)
      .del(`guest-owner:${playerKey}`)
      .del(`pace:${playerKey}`)
      .exec();
  }

  async totalsFor(playerKeys: string[]) {
    if (playerKeys.length === 0) return {};
    const values = await this.redis.hmget<Record<string, number | string | null>>("player-totals", ...playerKeys);
    return Object.fromEntries(playerKeys.map((k) => [k, Number(values?.[k] ?? 0) || 0]));
  }

  async getSession(id: string, now: number) {
    const flat = await this.redis.eval<string[], unknown>(SESSION_SCRIPT, [`session:${id}`], []);
    if (!Array.isArray(flat) || flat.length === 0) return null;
    const data: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) data[String(flat[i])] = String(flat[i + 1]);
    if (!data.playerKey) return null;
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
        session.profileId ? PROFILE_PACE_SCALE : 1,
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
    type Row = { key?: unknown; points?: unknown; name?: unknown; emoji?: unknown; rank?: unknown };
    const board = await this.redis.eval<(string | number)[], { top?: unknown; you?: unknown } | null>(LEADERBOARD_SCRIPT, [], [limit, playerKey ?? ""]);
    const entry = (row: Row, rank: number): LeaderboardEntry => ({
      rank,
      name: String(row.name || row.key),
      points: Number(row.points),
      ...(row.emoji ? { emoji: String(row.emoji) } : {}),
    });
    const rows = Array.isArray(board?.top) ? (board.top as Row[]) : [];
    const mine = board?.you && typeof board.you === "object" ? (board.you as Row) : null;
    return {
      top: rows.map((row, i) => entry(row, i + 1)).filter((e) => e.points > 0),
      you: mine && Number(mine.points) > 0 ? entry({ ...mine, key: playerKey }, Number(mine.rank) + 1) : null,
    };
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
