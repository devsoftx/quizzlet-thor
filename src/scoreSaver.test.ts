import { describe, expect, it } from "vitest";
import { scoreRound } from "./points";
import { ScoreSaver, type SavedScore, type SubmitScore } from "./scoreSaver";

/** A fake server that scores like the real one and can fail on demand. */
function fakeServer() {
  const calls: Array<{ answers: boolean[]; streakBefore: number; leaderboard: boolean }> = [];
  let total = 0;
  let failNext: "network" | "expired" | null = null;
  let release: (() => void) | null = null;
  let hold = false;

  const submit: SubmitScore = async (answers, { streakBefore, leaderboard }) => {
    calls.push({ answers: [...answers], streakBefore, leaderboard });
    if (hold) await new Promise<void>((r) => (release = r));
    if (failNext) {
      const kind = failNext;
      failNext = null;
      throw Object.assign(new Error(kind), { status: kind === "expired" ? 401 : 0 });
    }
    const points = scoreRound(answers, streakBefore).points;
    total += points;
    return { pointsEarned: points, sessionPoints: total, totalPoints: total, leaderboard: leaderboard ? { top: [], you: null } : null };
  };

  return {
    calls,
    submit,
    total: () => total,
    fail: (kind: "network" | "expired") => (failNext = kind),
    holdRequests: () => (hold = true),
    releaseOne: () => {
      hold = false;
      release?.();
    },
  };
}

function setup() {
  const server = fakeServer();
  const saved: SavedScore[] = [];
  let expired = false;
  const saver = new ScoreSaver(server.submit, {
    onSaved: (r) => saved.push(r),
    isExpired: (err) => (err as { status?: number }).status === 401,
    onExpired: () => (expired = true),
  });
  return { server, saver, saved, wasExpired: () => expired };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("saving points answer by answer", () => {
  it("saves each answer right away with the streak carried over", async () => {
    const { server, saver } = setup();
    saver.newRound();
    for (const a of [true, true, true, false, true]) {
      saver.add(a);
      await settle();
    }
    expect(server.total()).toBe(scoreRound([true, true, true, false, true]).points); // 45, same as all at once
    expect(server.calls.map((c) => c.streakBefore)).toEqual([0, 1, 2, 3, 0]);
    expect(saver.pending).toBe(0);
  });

  it("sends answers given during a slow save together, without double counting", async () => {
    const { server, saver } = setup();
    saver.newRound();
    server.holdRequests();
    saver.add(true); // in flight
    await settle();
    saver.add(true);
    saver.add(true); // queued meanwhile
    server.releaseOne();
    await saver.flush();
    expect(server.calls.map((c) => c.answers)).toEqual([[true], [true, true]]);
    expect(server.total()).toBe(35);
  });

  it("keeps answers when a save fails and sends them with the next one", async () => {
    const { server, saver } = setup();
    saver.newRound();
    server.fail("network");
    saver.add(true);
    await settle();
    expect(saver.pending).toBe(1);
    saver.add(true);
    await settle();
    expect(saver.pending).toBe(0);
    expect(server.total()).toBe(20);
  });

  it("starts each round's streak from zero", async () => {
    const { server, saver } = setup();
    saver.newRound();
    saver.add(true);
    saver.add(true);
    saver.add(true);
    await saver.flush();
    saver.newRound();
    saver.add(true);
    await saver.flush();
    expect(server.calls.at(-1)).toMatchObject({ answers: [true], streakBefore: 0 });
    expect(server.total()).toBe(35 + 10);
  });

  it("asks for the leaderboard when a round finishes, even with nothing left to send", async () => {
    const { server, saver } = setup();
    saver.newRound();
    saver.add(true);
    await settle(); // already saved
    const result = await saver.flush({ final: true });
    expect(server.calls.at(-1)).toEqual({ answers: [], streakBefore: 0, leaderboard: true });
    expect(result).toMatchObject({ totalPoints: 10, leaderboard: { top: [] } });
  });

  it("stops when the session has ended", async () => {
    const { server, saver, wasExpired } = setup();
    saver.newRound();
    server.fail("expired");
    saver.add(true);
    await settle();
    expect(wasExpired()).toBe(true);
    expect(saver.pending).toBe(0);
  });
});

describe("ambiguous score responses", () => {
  it("retries an identical batch with the same ID even if more answers arrive", async () => {
    const seen: Array<{ id: string | undefined; answers: boolean[] }> = [];
    let lost = true;
    const submit: SubmitScore = async (answers, options) => {
      seen.push({ id: options.batchId, answers: [...answers] });
      if (lost) { lost = false; throw new Error("response lost after commit"); }
      return { pointsEarned: 10, sessionPoints: 10, totalPoints: 10, leaderboard: null };
    };
    const saver = new ScoreSaver(submit, { onSaved: () => {}, isExpired: () => false, onExpired: () => {} });
    saver.newRound();
    saver.add(true);
    await settle();
    saver.add(false);
    await saver.flush();
    expect(seen[0].id).toBeTruthy();
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2].answers).toEqual([false]);
    expect(seen[2].id).not.toBe(seen[0].id);
  });
});

describe("session isolation", () => {
  it("does not send queued answers or apply an in-flight result after the session changes", async () => {
    let release!: (value: SavedScore) => void;
    const saved: number[] = [];
    const sent: boolean[][] = [];
    const submit: SubmitScore = (answers) => {
      sent.push([...answers]);
      if (sent.length === 1) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ pointsEarned: 0, sessionPoints: 0, totalPoints: 0, leaderboard: null });
    };
    const saver = new ScoreSaver(submit, { onSaved: (r) => saved.push(r.totalPoints), isExpired: () => false, onExpired: () => {} });
    saver.newRound();
    saver.add(true);
    await settle();
    saver.add(true); // queued in the original session
    saver.clear(); // session changes while first request is in flight
    saver.newRound();
    saver.add(false);
    release({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10, leaderboard: null });
    await saver.flush();
    expect(sent).toEqual([[true], [false]]);
    expect(saved).toEqual([0]);
  });
});

describe("definitive failures", () => {
  it("does not automatically resubmit a rejected batch when more answers arrive", async () => {
    let attempts = 0;
    const states: string[] = [];
    const saver = new ScoreSaver(async () => { attempts++; throw Object.assign(new Error("rejected"), { status: 409 }); }, {
      onSaved: () => {}, isExpired: () => false, onExpired: () => {},
      isRejected: (err) => (err as { status?: number }).status === 409,
      onState: (state) => states.push(state),
    });
    saver.newRound(); saver.add(true); await settle(); saver.add(false); await settle();
    expect(attempts).toBe(1);
    expect(states.at(-1)).toBe("failed");
    await expect(saver.flush()).rejects.toThrow("rejected");
    expect(attempts).toBe(1);
  });
});

describe("private deck finalization", () => {
  it("keeps the original deck and session binding on an empty final request", async () => {
    const calls: Array<{ deckId?: string; sessionTag?: string; answers: boolean[] }> = [];
    const saver = new ScoreSaver(async (answers, options) => {
      calls.push({ deckId: options.deckId, sessionTag: options.sessionTag, answers: [...answers] });
      return { pointsEarned: 0, sessionPoints: 0, totalPoints: 0, leaderboard: null };
    }, { onSaved: () => {}, isExpired: () => false, onExpired: () => {} });
    saver.newRound("private-deck", "session-tag");
    saver.add(false);
    await settle();
    await saver.flush({ final: true });
    expect(calls.at(-1)).toEqual({ deckId: "private-deck", sessionTag: "session-tag", answers: [] });
  });
});

describe("revocation at finalization", () => {
  it("reports the denied deck when the empty final request is rejected", async () => {
    let deniedDeck: string | undefined;
    let saves = 0;
    const saver = new ScoreSaver(async (answers) => {
      if (!answers.length) throw Object.assign(new Error("deck removed"), { status: 403 });
      return { pointsEarned: 10, sessionPoints: 10, totalPoints: 10, leaderboard: null };
    }, {
      onSaved: () => { saves++; }, isExpired: () => false, onExpired: () => {},
      isDenied: (err) => (err as { status?: number }).status === 403,
      onDenied: (_err, deckId) => { deniedDeck = deckId; },
    });
    saver.newRound("private-123", "session"); saver.add(true); await settle();
    await expect(saver.flush({ final: true })).rejects.toThrow("deck removed");
    expect(deniedDeck).toBe("private-123");
    expect(saves).toBe(1);
  });
});

describe("private deck access denial", () => {
  it("identifies the denied deck and clears queued inaccessible work", async () => {
    let deniedDeck: string | undefined;
    const saver = new ScoreSaver(async () => { throw Object.assign(new Error("deck removed"), { status: 403 }); }, {
      onSaved: () => {}, isExpired: () => false, onExpired: () => {},
      isDenied: (err) => (err as { status?: number }).status === 403,
      onDenied: (_err, deckId) => { deniedDeck = deckId; },
    });
    saver.newRound("private-123", "session"); saver.add(true); await settle();
    expect(deniedDeck).toBe("private-123");
    expect(saver.pending).toBe(0);
  });
});

describe("an expired round", () => {
  it("does not create or submit a new unbound round after the queue is cleared", async () => {
    const { server, saver } = setup();
    saver.newRound("private-deck", "expired-session");
    saver.add(true);
    await settle();
    saver.clear();
    saver.add(true);
    expect(await saver.flush({ final: true })).toBeNull();
    expect(server.calls).toHaveLength(1);
    expect(saver.pending).toBe(0);
  });
});

describe("the server asks to slow down", () => {
  it("keeps the batch and sends the very same one again later", async () => {
    const seen: Array<{ id: string; answers: boolean[] }> = [];
    const states: string[] = [];
    let busy = 2;
    const saver = new ScoreSaver(async (answers, options) => {
      seen.push({ id: options.batchId, answers: [...answers] });
      if (busy-- > 0) throw Object.assign(new Error("slow down"), { status: 429 });
      return { pointsEarned: 10, sessionPoints: 10, totalPoints: 10, leaderboard: null };
    }, {
      onSaved: () => {}, isExpired: () => false, onExpired: () => {},
      isRejected: (err) => [400, 409].includes((err as { status?: number }).status ?? 0),
      isThrottled: (err) => (err as { status?: number }).status === 429,
      onState: (state) => states.push(state),
    });
    saver.newRound();
    saver.add(true);
    await settle();
    expect(states.at(-1)).toBe("throttled");
    expect(saver.pending).toBe(1); // not lost, not rejected

    saver.add(false); // the next answer tries again: still too soon
    await settle();
    expect(states.at(-1)).toBe("throttled");
    await saver.flush(); // and later it fits
    expect(saver.pending).toBe(0);
    expect(states.at(-1)).toBe("confirmed");
    // The first batch went out three times unchanged, then the answer that queued up behind it.
    expect(seen.slice(0, 3).map((s) => s.id)).toEqual([seen[0].id, seen[0].id, seen[0].id]);
    expect(seen.map((s) => s.answers)).toEqual([[true], [true], [true], [false]]);
  });
});
