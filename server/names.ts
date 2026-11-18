// Nicknames: what a guest, a kid profile or a parent may call themselves.
//
// A guest's nickname is their identity on the public leaderboard, so besides
// the character rules a name must come from one alphabet (no look-alike
// letters from another script to pass as someone else) and must not contain a
// blocked word. The blocklist can't catch everything: scripts/remove-player.mjs
// takes an entry off the board afterwards.

export const NAME_MAX = 24;

export type NameProblem = "invalid" | "mixed-scripts" | "blocked";
export type NameCheck = { ok: true; name: string } | { ok: false; problem: NameProblem };

// ----------------------------------------------------------- One alphabet

/** The scripts a nickname's letters may come from. */
const SCRIPTS = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Armenian",
  "Hebrew",
  "Arabic",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Gujarati",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Sinhala",
  "Thai",
  "Lao",
  "Georgian",
  "Ethiopic",
  "Khmer",
  "Myanmar",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
] as const;

const SCRIPT_TESTS = SCRIPTS.map((script) => [script, new RegExp(`\\p{Script_Extensions=${script}}`, "u")] as const);

/** Scripts that one language writes together. */
const WRITTEN_TOGETHER: ReadonlySet<string>[] = [new Set(["Han", "Hiragana", "Katakana"]), new Set(["Han", "Hangul"])];

/** True when every letter comes from one alphabet (digits and punctuation don't count). */
function fromOneAlphabet(name: string): boolean {
  const found = new Set<string>();
  for (const char of name) {
    if (!/\p{L}/u.test(char)) continue;
    const script = SCRIPT_TESTS.find(([, test]) => test.test(char))?.[0];
    if (!script) return false; // a letter from no everyday alphabet
    found.add(script);
  }
  return found.size <= 1 || WRITTEN_TOGETHER.some((group) => [...found].every((script) => group.has(script)));
}

// -------------------------------------------------------------- Blocklist
// Three strengths, to keep ordinary names working ("Cassie", "Dickens",
// "Kshitij") while catching the obvious: a word that is blocked wherever it
// appears, one that is blocked at the start of a word, and one that is blocked
// only as a whole word.

const BLOCKED_ANYWHERE = [
  "fuck",
  "nigger",
  "nigga",
  "faggot",
  "bitch",
  "whore",
  "asshole",
  "arsehole",
  "bullshit",
  "dickhead",
  "cocksuck",
  "pussy",
  "wanker",
  "hitler",
  "blowjob",
  "handjob",
  "jizz",
  "cunt",
  "slut",
  "penis",
  "vagina",
  "dildo",
  "pedophile",
  "paedophile",
  "mierda",
  "pendejo",
];

const BLOCKED_WORD_START = ["shit", "rapist", "retard", "boob", "wank", "maricon", "chinga"];

const BLOCKED_WORD = [
  "ass",
  "asses",
  "arse",
  "sex",
  "sexy",
  "cock",
  "cocks",
  "dick",
  "dicks",
  "tit",
  "tits",
  "cum",
  "fag",
  "fags",
  "nazi",
  "nazis",
  "rape",
  "raped",
  "raper",
  "kkk",
  "anal",
  "anus",
  "homo",
  "spic",
  "chink",
  "kike",
  "coon",
  "paki",
  "gook",
  "tranny",
  "thot",
  "milf",
  "nude",
  "nudes",
  "porn",
  "porno",
  "xxx",
  "kys",
  "stfu",
  "pedo",
  "paedo",
  "piss",
  "puta",
  "putas",
  "puto",
  "putos",
  "culo",
  "verga",
  "joder",
  "cabron",
];

/** A word as a pattern that also matches stretched spellings ("shiiit"). */
const stretched = (word: string) => [...word].map((letter) => `${letter}+`).join("");
const anyOf = (words: string[]) => words.map(stretched).join("|");

const ANYWHERE = new RegExp(anyOf(BLOCKED_ANYWHERE));
const WORD_START = new RegExp(`^(?:${anyOf(BLOCKED_WORD_START)})`);
const WHOLE_WORD = new RegExp(`^(?:${anyOf(BLOCKED_WORD)})$`);

/** Digits often written in place of letters. */
const LOOKALIKE_DIGITS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" };

/** Lowercase and without accents: "Fück" -> "fuck". */
const folded = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function hasBlockedWord(text: string): boolean {
  const words = text.split(/[^a-z]+/).filter(Boolean);
  const joined = words.join("");
  if (ANYWHERE.test(joined)) return true;
  if (words.some((word) => WORD_START.test(word) || WHOLE_WORD.test(word))) return true;
  // Spelled out with gaps ("a s s"): judge the letters as one word.
  const spelledOut = words.length > 1 && words.every((word) => word.length <= 2);
  return spelledOut && (WORD_START.test(joined) || WHOLE_WORD.test(joined));
}

/** True when the name contains a blocked word, also with digits standing in for letters. */
export function isBlockedName(name: string): boolean {
  const plain = folded(name);
  const withDigitsAsLetters = plain.replace(/[013457]/g, (digit) => LOOKALIKE_DIGITS[digit]);
  return hasBlockedWord(plain) || hasBlockedWord(withDigitsAsLetters);
}

// ------------------------------------------------------------------ Check

/**
 * Tidies a nickname and says what's wrong with it, if anything. Trims and
 * collapses spaces; allows letters, numbers, spaces and - ' . only.
 */
export function checkName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, problem: "invalid" };
  // NFKC also turns styled letters (fullwidth, mathematical bold…) into plain ones.
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, problem: "invalid" };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) return { ok: false, problem: "invalid" };
  if (!fromOneAlphabet(name)) return { ok: false, problem: "mixed-scripts" };
  if (isBlockedName(name)) return { ok: false, problem: "blocked" };
  return { ok: true, name };
}

/** The tidied nickname, or null when it isn't allowed. */
export function cleanName(raw: unknown): string | null {
  const check = checkName(raw);
  return check.ok ? check.name : null;
}

/** What to tell someone whose nickname was refused. `what` is "nickname" or "name". */
export function nameProblemMessage(problem: NameProblem, what = "nickname"): string {
  if (problem === "blocked") return `That ${what} isn't allowed. Please choose a different one.`;
  if (problem === "mixed-scripts") return `Please use letters from one alphabet in your ${what}.`;
  return `Please enter a ${what} (up to ${NAME_MAX} letters, numbers or spaces).`;
}
