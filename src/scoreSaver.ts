// Saves answer batches one at a time. A tab closing can interrupt the in-memory queue.

import type { Leaderboard } from "./api";
import type { AttemptDetail } from "./attempts";
import { scoreRound } from "./points";

export interface SavedScore {
  pointsEarned: number;
  sessionPoints: number;
  totalPoints: number;
  /** Only when asked for (the round's last save). */
  leaderboard: Leaderboard | null;
}

export type SubmitScore = (
  answers: boolean[],
  options: { streakBefore: number; leaderboard: boolean; keepalive: boolean; batchId: string; deckId?: string; sessionTag?: string; details?: AttemptDetail[] },
) => Promise<SavedScore>;

interface Hooks {
  /** After every successful save (e.g. to update the points shown). */
  onSaved: (result: SavedScore) => void;
  /** True when an error means the session is over (nothing more can be saved). */
  isExpired: (err: unknown) => boolean;
  onExpired: () => void;
  isDenied?: (err: unknown) => boolean;
  onDenied?: (err: unknown, deckId?: string) => void;
  isRejected?: (err: unknown) => boolean;
  onState?: (state: "pending" | "saving" | "confirmed" | "unknown" | "failed" | "expired" | "denied") => void;
}

interface Round {
  /** Answers not saved yet. */
  answers: boolean[];
  /** What each of those answers tells a parent's Progress page (kid profiles only; null for guests). */
  details: (AttemptDetail | null)[];
  /** The streak just before answers[0], so bonuses match the live score. */
  streakBefore: number;
  deckId?: string;
  sessionTag?: string;
  batch?: { id: string; answers: boolean[]; details?: AttemptDetail[]; streakBefore: number; leaderboard: boolean };
}

/** The next batch of a round: what's waiting now, sent (and resent) as is until it's saved. */
function newBatch(round: Round, leaderboard: boolean): NonNullable<Round["batch"]> {
  const details = round.details.slice(0, round.answers.length);
  const complete = details.length > 0 && details.every((d): d is AttemptDetail => d !== null);
  return { id: crypto.randomUUID(), answers: round.answers.slice(), ...(complete ? { details } : {}), streakBefore: round.streakBefore, leaderboard };
}

export class ScoreSaver {
  private rounds: Round[] = [];
  private running: Promise<SavedScore | null> | null = null;
  private generation = 0;
  private rejected: unknown = null;

  constructor(
    private submit: SubmitScore,
    private hooks: Hooks,
  ) {}

  /** A new deck or retry: its streak starts from zero. */
  newRound(deckId?: string, sessionTag?: string): void {
    this.rounds.push({ answers: [], details: [], streakBefore: 0, deckId, sessionTag });
  }

  /** Records an answer (with its details, for a kid profile) and saves it in the background. */
  add(correct: boolean, detail?: AttemptDetail): void {
    if (this.rounds.length === 0) return; // No active round (for example, after expiry).
    const round = this.rounds.at(-1)!;
    round.answers.push(correct);
    round.details.push(detail ?? null);
    if (this.rejected !== null) { this.hooks.onState?.("failed"); return; }
    this.hooks.onState?.("pending");
    this.flush().catch(() => undefined); // stays queued; retried on the next save
  }

  /** Answers waiting to be saved. */
  get pending(): number {
    return this.rounds.reduce((n, r) => n + r.answers.length, 0);
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /** Forgets unsaved answers (the session ended and they can't be saved). */
  clear(): void {
    this.generation++;
    this.rounds = [];
    this.rejected = null;
  }

  /**
   * Saves everything not yet saved. With `final` (a finished round), the last
   * save also returns the totals and leaderboard, even if nothing was left to send.
   */
  async flush(options: { final?: boolean; keepalive?: boolean } = {}): Promise<SavedScore | null> {
    const generation = this.generation;
    while (this.running) await this.running.catch(() => null);
    if (generation !== this.generation) return null;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- rethrows the error a rejected save failed with, as it was
    if (this.rejected !== null) throw this.rejected;
    const mine = this.drain(options, generation);
    this.running = mine;
    try {
      return await mine;
    } finally {
      if (this.running === mine) this.running = null;
    }
  }

  private async drain({ final = false, keepalive = false }: { final?: boolean; keepalive?: boolean }, generation: number): Promise<SavedScore | null> {
    let last: SavedScore | null = null;
    for (;;) {
      // Finished rounds with nothing left can go; the current one keeps its streak.
      while (this.rounds.length > 1 && this.rounds[0].answers.length === 0) this.rounds.shift();
      const round = this.rounds.find((r) => r.answers.length > 0);
      if (!round) break;
      const moreAfter = this.rounds.some((r) => r !== round && r.answers.length > 0);
      round.batch ??= newBatch(round, final && !moreAfter);
      const batch = round.batch;
      this.hooks.onState?.("saving");
      try {
        last = await this.submit(batch.answers, { streakBefore: batch.streakBefore, leaderboard: batch.leaderboard, keepalive, batchId: batch.id, deckId: round.deckId, sessionTag: round.sessionTag, ...(batch.details ? { details: batch.details } : {}) });
      } catch (err) {
        if (generation !== this.generation) return null;
        this.handleError(err, round.deckId);
        throw err;
      }
      if (generation !== this.generation) return null;
      round.answers.splice(0, batch.answers.length);
      round.details.splice(0, batch.answers.length);
      round.streakBefore = scoreRound(batch.answers, batch.streakBefore).streak;
      round.batch = undefined;
      this.hooks.onSaved(last);
      this.hooks.onState?.(this.pending ? "pending" : "confirmed");
    }
    // When all answers were saved earlier, fetch current totals with an empty batch.
    // The leaderboard is loaded independently when the learner opens it.
    if (final && !last && this.rounds.length > 0) {
      const round = this.rounds.at(-1);
      try {
        last = await this.submit([], { streakBefore: 0, leaderboard: true, keepalive, batchId: crypto.randomUUID(), deckId: round?.deckId, sessionTag: round?.sessionTag });
      } catch (err) {
        if (generation !== this.generation) return null;
        this.handleError(err, round?.deckId);
        throw err;
      }
      if (generation !== this.generation) return null;
      this.hooks.onSaved(last);
    }
    return last;
  }
  private handleError(err: unknown, deckId?: string): void {
    if (this.hooks.isExpired(err)) {
      this.clear();
      this.hooks.onState?.("expired");
      this.hooks.onExpired();
    } else if (this.hooks.isDenied?.(err)) {
      this.clear();
      this.hooks.onState?.("denied");
      this.hooks.onDenied?.(err, deckId);
    } else if (this.hooks.isRejected?.(err)) {
      this.rejected = err;
      this.hooks.onState?.("failed");
    } else this.hooks.onState?.("unknown");
  }

}
