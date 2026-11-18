import { describe, expect, it } from "vitest";
import { checkName, cleanName, hasBuiltInBlockedWord, nameProblemMessage } from "./names.js";

const problem = (name: unknown) => {
  const check = checkName(name);
  return check.ok ? null : check.problem;
};

describe("nicknames", () => {
  it("accepts everyday names in any one alphabet", () => {
    for (const name of ["Ana", "Ana María", "O'Neil-2", "Nova7", "007", "J.R.", "Zoë", "Łukasz", "Иван", "Ελένη", "דנה", "علي", "たなか花子", "コーヒー", "김민준", "王小明"]) {
      expect(problem(name), name).toBeNull();
    }
  });

  it("tidies spaces and styled letters", () => {
    expect(cleanName("  Ana   María ")).toBe("Ana María");
    // Fullwidth and mathematical letters become the plain ones they imitate.
    expect(cleanName("Ａｎａ")).toBe("Ana");
    expect(cleanName("\u{1D400}\u{1D427}\u{1D41A}")).toBe("Ana");
  });

  it("rejects empty, too long or odd names", () => {
    for (const name of ["", "   ", "x".repeat(25), "<script>", "p:abc", "-Ana", "Ana!", 42, null, undefined, ["Ana"]]) {
      expect(problem(name), String(name)).toBe("invalid");
    }
  });

  it("rejects letters from two alphabets (look-alikes)", () => {
    for (const name of ["Аna", "Anа", "Αna", "Ana Иван", "Ana花"]) {
      expect(problem(name), name).toBe("mixed-scripts");
    }
    // Scripts that one language writes together are fine.
    expect(problem("花子さくらサクラ")).toBeNull();
    expect(problem("金민준")).toBeNull();
    // But not the Korean and Japanese sets with each other.
    expect(problem("さくら민준")).toBe("mixed-scripts");
  });

  it("rejects blocked words, however they are dressed up", () => {
    for (const name of [
      "Shithead",
      "sh1thead",
      "SHIIIT",
      "Big Ass",
      "A55",
      "a s s",
      "A.S.S",
      "F u c k",
      "fück",
      "xXfuckXx",
      "Mr Dick",
      "sexy",
      "Nazi",
      "Puta",
      "kkk",
    ]) {
      expect(problem(name), name).toBe("blocked");
    }
  });

  it("doesn't trip on ordinary names that contain those letters", () => {
    for (const name of ["Cassie", "Dickens", "Kshitij", "Analia", "Sussex", "Hancock", "Pornthip", "Nazir", "Titus", "Grape", "Assunta", "Vergara", "Therapy", "Cummings", "Bass", "Class 5", "Sam 2"]) {
      expect(hasBuiltInBlockedWord(name), name).toBe(false);
      expect(problem(name), name).toBeNull();
    }
  });

  it("explains each problem", () => {
    expect(nameProblemMessage("invalid")).toBe("Please enter a nickname (up to 24 letters, numbers or spaces).");
    expect(nameProblemMessage("invalid", "name")).toBe("Please enter a name (up to 24 letters, numbers or spaces).");
    expect(nameProblemMessage("blocked")).toBe("Please choose a different nickname.");
    expect(nameProblemMessage("blocked", "name")).toBe("Please choose a different name.");
    expect(nameProblemMessage("mixed-scripts")).toBe("Please use letters from one alphabet in your nickname.");
  });
});
