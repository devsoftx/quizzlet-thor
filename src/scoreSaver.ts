// Saves points answer by answer, so leaving a deck early, ending a session or
// closing the tab never loses what was already earned. One request at a time;
// anything that fails stays queued and goes with the next save.

import type { Leaderboard } from "./api";
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
  options: { streakBefore: number; leaderboard: boolean; keepalive: boolean },
) => Promise<SavedScore>;

interface Hooks {
  /** After every successful save (e.g. to update the points shown). */
  onSaved: (result: SavedScore) => void;
  /** True when an error means the session is over (nothing more can be saved). */
  isExpired: (err: unknown) => boolean;
  onExpired: () => void;
}

interface Round {
  /** Answers not saved yet. */
  answers: boolean[];
  /** The streak just before answers[0], so bonuses match the live score. */
  streakBefore: number;
}

export class ScoreSaver {
  private rounds: Round[] = [];
  private running: Promise<SavedScore | null> | null = null;

  constructor(
    private submit: SubmitScore,
    private hooks: Hooks,
  ) {}

  /** A new deck or retry: its streak starts from zero. */
  newRound(): void {
    this.rounds.push({ answers: [], streakBefore: 0 });
  }

  /** Records an answer and saves it in the background. */
  add(correct: boolean): void {
    if (this.rounds.length === 0) this.newRound();
    this.rounds.at(-1)!.answers.push(correct);
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
    this.rounds = [];
  }

  /**
   * Saves everything not yet saved. With `final` (a finished round), the last
   * save also returns the totals and leaderboard, even if nothing was left to send.
   */
  async flush(options: { final?: boolean; keepalive?: boolean } = {}): Promise<SavedScore | null> {
    while (this.running) await this.running.catch(() => null);
    const mine = this.drain(options);
    this.running = mine;
    try {
      return await mine;
    } finally {
      if (this.running === mine) this.running = null;
    }
  }

  private async drain({ final = false, keepalive = false }): Promise<SavedScore | null> {
    let last: SavedScore | null = null;
    for (;;) {
      // Finished rounds with nothing left can go; the current one keeps its streak.
      while (this.rounds.length > 1 && this.rounds[0].answers.length === 0) this.rounds.shift();
      const round = this.rounds.find((r) => r.answers.length > 0);
      if (!round) break;
      const batch = round.answers.slice();
      const moreAfter = this.rounds.some((r) => r !== round && r.answers.length > 0);
      try {
        last = await this.submit(batch, { streakBefore: round.streakBefore, leaderboard: final && !moreAfter, keepalive });
      } catch (err) {
        if (this.hooks.isExpired(err)) {
          this.clear();
          this.hooks.onExpired();
        }
        throw err;
      }
      round.answers.splice(0, batch.length);
      round.streakBefore = scoreRound(batch, round.streakBefore).streak;
      this.hooks.onSaved(last);
    }
    if (final && !last?.leaderboard) {
      last = await this.submit([], { streakBefore: 0, leaderboard: true, keepalive });
      this.hooks.onSaved(last);
    }
    return last;
  }
}
