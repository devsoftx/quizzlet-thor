import { describe, expect, it } from "vitest";
import { checkSessionAccess } from "./sessionAccess";

describe("access checks across session changes", () => {
  for (const outcome of ["success", "denial"] as const) {
    it(`ignores a late ${outcome} after the session changes`, async () => {
      let current: string | undefined = "first";
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const result = checkSessionAccess("first", () => current, () => pending);
      current = "second";
      if (outcome === "success") resolve(); else reject(new Error("denied"));
      expect(await result).toEqual({ status: "stale" });
    });
  }
  it("ignores a completed check when the session expires during the request", async () => {
    let current: string | undefined = "first";
    let resolve!: () => void;
    const pending = new Promise<void>((yes) => { resolve = yes; });
    const result = checkSessionAccess("first", () => current, () => pending);
    current = undefined;
    resolve();
    expect(await result).toEqual({ status: "stale" });
  });
  it("returns a denial for the still-active session", async () => {
    const error = new Error("denied");
    expect(await checkSessionAccess("first", () => "first", async () => { throw error; })).toEqual({ status: "denied", error });
  });
  it("treats expiry or an absent session identifier as stale", async () => {
    expect(await checkSessionAccess("first", () => undefined, async () => {})).toEqual({ status: "stale" });
    expect(await checkSessionAccess(undefined, () => undefined, async () => {})).toEqual({ status: "stale" });
  });
});
