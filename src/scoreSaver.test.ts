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
