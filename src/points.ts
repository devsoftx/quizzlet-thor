// Points rules, shared by the browser (live score) and the server (saved score).

export const POINTS_PER_CORRECT = 10;
/** Extra points for each correct answer once you're on a streak of 3 or more. */
export const STREAK_BONUS = 5;
export const STREAK_THRESHOLD = 3;
/** Longest round the server will accept. */
export const MAX_ROUND_LENGTH = 200;

export interface AnswerPoints {
  points: number;
  /** Consecutive correct answers including this one (0 when wrong). */
  streak: number;
  bonus: boolean;
}

/** Points for one answer, given the streak *before* it. */
export function pointsForAnswer(correct: boolean, streakBefore: number): AnswerPoints {
  if (!correct) return { points: 0, streak: 0, bonus: false };
  const streak = streakBefore + 1;
  const bonus = streak >= STREAK_THRESHOLD;
  return { points: POINTS_PER_CORRECT + (bonus ? STREAK_BONUS : 0), streak, bonus };
}

export interface RoundScore {
  points: number;
  correct: number;
  bestStreak: number;
}

/**
 * Points for a run of answers. `streakBefore` carries a streak over from the
 * answers already saved, so saving a round in pieces scores the same as all at once.
 */
export function scoreRound(answers: readonly boolean[], streakBefore = 0): RoundScore & { streak: number } {
  let points = 0;
  let correct = 0;
  let streak = streakBefore;
  let bestStreak = 0;
  for (const answer of answers) {
    const result = pointsForAnswer(answer, streak);
    points += result.points;
    streak = result.streak;
    if (answer) correct++;
    bestStreak = Math.max(bestStreak, streak);
  }
  return { points, correct, bestStreak, streak };
}
