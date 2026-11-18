// Nicknames: what a guest, a kid profile or a parent may call themselves.
//
// A nickname can end up on the public leaderboard, so besides the character
// rules a name must come from one alphabet (no look-alike letters from another
// script to pass as someone else) and must not contain a word from the
// built-in list below. These rules are always on, for guests and for kid
// profiles alike.
//
// The list can't catch everything. An operator adds words without a deploy
// through `blockedNames` (server/flags.ts, guests only), and takes an entry
// off the board with scripts/leaderboard-remove.mjs.

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
// "Kshitij", "Maricela", "Vergara") while catching the obvious: a word that is
// blocked wherever it appears, one that is blocked at the start of a word, and
// one that is blocked only as a whole word.
//
// English and Spanish (the app's two languages), Latin American and Spain
// variants. Words are written without accents ("maricón" is "maricon") because
// names are compared that way. "Anywhere" is checked with the name's words
// joined up, so a word only goes there if it can't appear across two ordinary
// names ("Fred Skinner" holds "redskin": that one goes in "start of word").
// Every letter may also be repeated ("puuuta"), so a word is left out when a
// common name is that word with a doubled letter ("polack" would block Pollack,
// "jap" the Dutch name Jaap, "pene" the pasta Penne).

const BLOCKED_ANYWHERE = [
  // English: swearing and sex
  "fuck",
  "bitch",
  "whore",
  "asshole",
  "arsehole",
  "bullshit",
  "dickhead",
  "cocksuck",
  "pussy",
  "wanker",
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
  // English: slurs and hate
  "nigger",
  "nigga",
  "nigguh",
  "faggot",
  "wetback",
  "towelhead",
  "jigaboo",
  "jiggaboo",
  "zipperhead",
  "slanteye",
  "golliwog",
  "mongoloid",
  "hitler",
  "siegheil",
  "whitepower",
  // Spanish: swearing and sex
  "mierda",
  "pendejo",
  "pendeja",
  "hijodeputa",
  "hijadeputa",
  "hijueputa",
  "hijoeputa",
  "joputa",
  "putamadre",
  "conchatumadre",
  "conchetumadre",
  "conchesumadre",
  "conchasumadre",
  "conchatumare",
  "conchetumare",
  "conchesumare",
  "chuchatumadre",
  "chuchasumadre",
  "malparid", // malparido, malparida
  "gonorrea",
  "mamahuevo",
  "mamaguevo",
  "prostitut", // prostituta (and English "prostitute")
  "pedofil", // pedófilo
  // Spanish: slurs
  "mongolic", // mongólico
  "mogolic", // mogólico
];

const BLOCKED_WORD_START = [
  // English
  "shit",
  "rapist",
  "retard",
  "boob",
  "wank",
  "beaner",
  "redskin",
  "raghead",
  "shemale",
  // Spanish
  "maricon",
  "chinga", // chingada, chingar…
  "cabron", // cabrona, cabrones
  "culer", // culero, culera
  "cagad", // cagada, cagado
  "violad", // violador, violada
  "pelotud",
  "pichula",
  "gilipoll",
  "chupaverga",
  "chupapija",
  "chupapinga",
  "mamaverga",
  "mamabicho",
  "culiad",
  "culead",
];

const BLOCKED_WORD = [
  // English: swearing and sex
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
  "anal",
  "anus",
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
  "rape",
  "raped",
  "raper",
  // English: slurs and hate
  "fag",
  "fags",
  "homo",
  "dyke",
  "dykes",
  "lesbo",
  "lezbo",
  "poofter",
  "tranny",
  "trannies",
  "spic",
  "spics",
  "spick",
  "chink",
  "chinks",
  "kike",
  "kikes",
  "coon",
  "coons",
  "paki",
  "pakis",
  "gook",
  "gooks",
  "darkie",
  "darky",
  "wog",
  "wogs",
  "wop",
  "wops",
  "dago",
  "dagos",
  "kraut",
  "krauts",
  "honky",
  "honkey",
  "squaw",
  "injun",
  "gyppo",
  "gypo",
  "pikey",
  "muzzie",
  "spaz",
  "spazz",
  "nazi",
  "nazis",
  "kkk",
  // Spanish: swearing and sex
  "puta",
  "putas",
  "puto",
  "putos",
  "puton",
  "putona",
  "putita",
  "putito",
  "zorra",
  "zorras",
  "perra",
  "perras",
  "ramera",
  "furcia",
  "culo",
  "verga",
  "vergas",
  "polla",
  "pollas",
  "pinga",
  "pingas",
  "picha",
  "teta",
  "tetas",
  "tetona",
  "cojon",
  "cojones",
  "joder",
  "jodete",
  "follar",
  "follando",
  "follame",
  "cagar",
  "cagon",
  "cagona",
  "mamada",
  "mamadas",
  "ojete",
  "pajero",
  "pajera",
  "chupamela",
  "chupala",
  "culiao",
  "huevon",
  "huevona",
  "guevon",
  "weon",
  "weona",
  "webon",
  "boludo",
  "boluda",
  "ctm",
  "csm",
  "hdp",
  "ptm",
  "matate", // mátate: "kill yourself"
  "suicidate",
  // Spanish: slurs
  "marica",
  "maricas",
  "maraco",
  "joto",
  "jotos",
  "trolo",
  "mariposon",
  "tortillera",
  "bollera",
  "travelo",
  "sudaca",
  "sudacas",
  "negrata",
  "mayate",
  "moraco",
  "veneco",
  "retrasado",
  "retrasada",
  "subnormal",
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

/** True when the name contains a word from the built-in list, also with digits standing in for letters. */
export function hasBuiltInBlockedWord(name: string): boolean {
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
  if (hasBuiltInBlockedWord(name)) return { ok: false, problem: "blocked" };
  return { ok: true, name };
}

/** The tidied nickname, or null when it isn't allowed. */
export function cleanName(raw: unknown): string | null {
  const check = checkName(raw);
  return check.ok ? check.name : null;
}

/** What to tell someone whose nickname was refused. `what` is "nickname" or "name". */
export function nameProblemMessage(problem: NameProblem, what = "nickname"): string {
  if (problem === "blocked") return `Please choose a different ${what}.`;
  if (problem === "mixed-scripts") return `Please use letters from one alphabet in your ${what}.`;
  return `Please enter a ${what} (up to ${NAME_MAX} letters, numbers or spaces).`;
}
