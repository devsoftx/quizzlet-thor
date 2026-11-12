// Account and kid-profile shapes and options, shared by the browser and the server.

export const THEMES = ["system", "light", "dark"] as const;
export const SHUFFLE_MODES = ["deck", "on", "off"] as const;
export const GRADE_BANDS = ["k-2", "3-5", "6-8", "9-12"] as const;
export const PROFILE_COLORS = ["#4255ff", "#128a5a", "#c9354a", "#b7791f", "#7c3aed", "#0e7490"] as const;
export const PROFILE_EMOJIS = ["🦊", "🐼", "🦉", "🐢", "🦄", "🐙", "🚀", "⭐"] as const;
export const MAX_PROFILES = 20;

export const GRADE_LABELS: Record<(typeof GRADE_BANDS)[number], string> = {
  "k-2": "Grades K–2",
  "3-5": "Grades 3–5",
  "6-8": "Grades 6–8",
  "9-12": "Grades 9–12",
};

export interface AccountSettings {
  theme: (typeof THEMES)[number];
  /** Card order: follow each deck's setting, or always/never shuffle. */
  shuffle: (typeof SHUFFLE_MODES)[number];
}

export const DEFAULT_SETTINGS: AccountSettings = { theme: "system", shuffle: "deck" };

/** A child's study profile: a nickname only, managed by the parent's account. */
export interface KidProfile {
  id: string;
  nickname: string;
  gradeBand: (typeof GRADE_BANDS)[number] | null;
  color: string;
  emoji: string;
  /** Off by default; the parent opts in to the public leaderboard. */
  showOnLeaderboard: boolean;
  createdAt: string;
}

export type ProfileInput = Pick<KidProfile, "nickname" | "gradeBand" | "color" | "emoji" | "showOnLeaderboard">;

export function normalizeSettings(raw: unknown): AccountSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: THEMES.includes(s.theme as AccountSettings["theme"]) ? (s.theme as AccountSettings["theme"]) : "system",
    shuffle: SHUFFLE_MODES.includes(s.shuffle as AccountSettings["shuffle"])
      ? (s.shuffle as AccountSettings["shuffle"])
      : "deck",
  };
}
