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

// ------------------------------------------------- Private decks and files

export const MAX_DECKS = 50;
/** Per deck. The biggest bundled deck is about 21 KB. */
export const MAX_DECK_BYTES = 64 * 1024;
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024;

/** File types parents can keep (study material for decks), by media type. */
export const FILE_TYPES = {
  "application/pdf": { label: "PDF", extensions: ["pdf"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word", extensions: ["docx"] },
  "image/png": { label: "PNG image", extensions: ["png"] },
  "image/jpeg": { label: "JPEG image", extensions: ["jpg", "jpeg"] },
  "image/webp": { label: "WebP image", extensions: ["webp"] },
} as const;
export type FileType = keyof typeof FILE_TYPES;
export const FILE_ACCEPT = Object.values(FILE_TYPES)
  .flatMap((t) => t.extensions.map((e) => `.${e}`))
  .join(",");

/** The media type for a file name, when it's one we accept. */
export function fileTypeFor(name: string): FileType | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  for (const [type, info] of Object.entries(FILE_TYPES)) {
    if ((info.extensions as readonly string[]).includes(ext)) return type as FileType;
  }
  return null;
}

/** A deck saved in a parent's account. */
export interface AccountDeck {
  id: string;
  title: string;
  description: string | null;
  cardCount: number;
  yaml: string;
  /** Off hides the deck from every kid. */
  enabled: boolean;
  /** Which kids see it; null means all of them. */
  profileIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export type DeckInput = Pick<AccountDeck, "title" | "description" | "cardCount" | "yaml" | "enabled" | "profileIds">;
export type DeckPatch = Partial<Pick<AccountDeck, "title" | "enabled" | "profileIds">>;

/** A file in a parent's private storage (the storage path stays on the server). */
export interface AccountFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export function normalizeSettings(raw: unknown): AccountSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: THEMES.includes(s.theme as AccountSettings["theme"]) ? (s.theme as AccountSettings["theme"]) : "system",
    shuffle: SHUFFLE_MODES.includes(s.shuffle as AccountSettings["shuffle"])
      ? (s.shuffle as AccountSettings["shuffle"])
      : "deck",
  };
}
