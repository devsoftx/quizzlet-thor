// Names for the end-to-end tests: different every time, and always ones the
// app accepts.
//
// A name is the test's own prefix plus a random tail. Random letters and
// digits now and then spell a word on the app's nickname blocklist
// ("Dark" + "y3r4arlred" is "Darky…", which the server refuses), and then a
// test that only wanted a fresh name fails for a reason that has nothing to do
// with it. So each candidate is put to the server's own rule, and drawn again
// until it passes. Using that rule itself, instead of a "safe" set of
// characters, keeps this true when the blocklist or its look-alike digits change.
import { randomBytes } from "node:crypto";
import { checkName, NAME_MAX } from "../server/names";

const TAIL_LENGTH = 10;
/** Fewer random characters than this and two names could come out the same. */
const MIN_TAIL_LENGTH = 6;
const ATTEMPTS = 100;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Ten random lowercase letters and digits. */
export function randomTail(): string {
  return Array.from(randomBytes(TAIL_LENGTH), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/**
 * A unique nickname, id or title: `prefix` plus random letters and digits, at
 * most 24 characters, and never one the app's nickname rules refuse.
 * (`tail` is only for this helper's own tests.)
 */
export function unique(prefix: string, tail: () => string = randomTail): string {
  if (prefix.length > NAME_MAX - MIN_TAIL_LENGTH) {
    throw new Error(`unique(${JSON.stringify(prefix)}): the prefix leaves no room for a random part; keep it to ${NAME_MAX - MIN_TAIL_LENGTH} characters.`);
  }
  let problem = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const name = `${prefix}${tail()}`.slice(0, NAME_MAX);
    const check = checkName(name);
    if (check.ok) return name;
    problem = check.problem;
  }
  // Not bad luck: no tail helps, so the prefix itself is what the app refuses.
  throw new Error(`unique(${JSON.stringify(prefix)}): the app refuses every name with this prefix (${problem}); pick another prefix.`);
}
