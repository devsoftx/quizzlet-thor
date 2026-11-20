// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api, ApiError, type SessionInfo } from "./api";
import axe from "axe-core";
import { App } from "./App";

const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock("./auth", () => ({ AUTH_MODE: "dev", useAccountAuth: () => ({ isLoaded: true, isSignedIn: auth.signedIn, signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("./library", async (original) => {
  const actual = await original<typeof import("./library")>();
  return { ...actual, loadBundledDecks: () => [{ id: "bundled:test", fileName: "test.yaml", source: "bundled", ok: true, deck: { title: "Space test", enabled: true, shuffle: false, shuffleOptions: false, cards: [{ question: "Our star?", options: ["Sun", "Moon"], answer: "Sun" }, { question: "Our planet?", options: ["Earth", "Mars"], answer: "Earth" }] } }] };
});

/** Chooses an answer and checks it, as a learner does: tap an option, then "Check answer". */
function answer(option: string) {
  fireEvent.click(screen.getByRole("button", { name: option }));
  fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
}

function session(ms = 10000, profileId: string | null = null): SessionInfo {
  return { name: "Nova", points: 0, deadline: Date.now() + ms, profileId, sessionTag: "session-one" };
}

beforeEach(() => {
  auth.signedIn = false;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  vi.spyOn(api, "kidHome").mockResolvedValue(null);
  vi.spyOn(api, "getSession").mockResolvedValue(session());
  vi.spyOn(api, "submitScore").mockResolvedValue({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10, leaderboard: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("session expiry in the learner journey", () => {
  it("returns from a preview to a new-session route when the session expires", async () => {
    vi.mocked(api.getSession).mockResolvedValue(session(1500));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    expect(await screen.findByRole("button", { name: /start practice/i })).toBeTruthy();
    expect(await screen.findByText(/your session has ended/i, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start practice/i })).toBeNull();
    expect(screen.getByLabelText(/your nickname/i)).toBeTruthy();
  });

  it("shows confirmed points and does not submit answers after expiry", async () => {
    vi.mocked(api.getSession).mockResolvedValue(session(1500));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    answer("Sun");
    await waitFor(() => expect(api.submitScore).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    await screen.findByText(/your latest points may not have been saved/i, {}, { timeout: 4000 });
    answer("Earth");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    expect(await screen.findByText(/10 points.*confirmed/i)).toBeTruthy();
    expect(api.submitScore).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /start a new session/i }));
    const name = await screen.findByLabelText(/your nickname/i);
    vi.spyOn(api, "startSession").mockResolvedValue({ ...session(), sessionTag: "new-session" });
    fireEvent.change(name, { target: { value: "Nova" } });
    fireEvent.click(screen.getByRole("button", { name: /start exploring/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    expect(screen.getByText("Points saved")).toBeTruthy();
  });
});

const privateDeck = {
  id: "private-one", title: "Private science", description: null, cardCount: 1, enabled: true, profileIds: ["kid-one"], createdAt: "", updatedAt: "",
  yaml: "title: Private science\nenabled: true\nshuffle: false\nshuffleOptions: false\ncards:\n  - question: Our star?\n    options: [Sun, Moon]\n    answer: Sun\n",
};
const profile = { id: "kid-one", nickname: "Nova", gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false, createdAt: "" } as const;

describe("private-deck access in the learner journey", () => {
  for (const route of ["linked", "parent"] as const) {
    it(`removes the denied deck from the ${route} library`, async () => {
      vi.mocked(api.getSession).mockResolvedValue(session(10000, "kid-one"));
      vi.spyOn(api, "checkPrivateDeck").mockRejectedValue(new ApiError("This deck is no longer available.", 403));
      if (route === "linked") {
        vi.mocked(api.kidHome).mockResolvedValue({ profile, decks: [privateDeck], totalPoints: 0 });
      } else {
        auth.signedIn = true;
        vi.spyOn(api, "getMe").mockResolvedValue({ account: { displayName: "Adult", plan: "free", settings: { theme: "system", shuffle: "deck" } }, profiles: [profile], points: {} });
        vi.spyOn(api, "listDecks").mockResolvedValue([privateDeck]);
      }
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Study Private science" }));
      expect(await screen.findByText(/this deck couldn't be opened/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Study Private science" })).toBeNull();
      expect(screen.getByRole("button", { name: "Study Space test" })).toBeTruthy();
    });
  }

  it("does not open a preview if access resolves after expiry", async () => {
    vi.mocked(api.getSession).mockResolvedValue(session(1500, "kid-one"));
    vi.mocked(api.kidHome).mockResolvedValue({ profile, decks: [privateDeck], totalPoints: 0 });
    let allow!: () => void;
    vi.spyOn(api, "checkPrivateDeck").mockImplementation(() => new Promise<void>((resolve) => { allow = resolve; }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Private science" }));
    expect(await screen.findByText(/your session has ended/i, {}, { timeout: 4000 })).toBeTruthy();
    allow();
    await waitFor(() => expect(screen.queryByRole("button", { name: /start practice/i })).toBeNull());
  });
});

describe("score recovery in the learner journey", () => {
  it("offers a retry after an unknown save and reuses the same batch", async () => {
    vi.mocked(api.submitScore).mockRejectedValueOnce(new ApiError("Connection interrupted", 0));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    answer("Sun");
    expect(await screen.findByText(/couldn't confirm whether your latest points were saved/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /decks/i }));
    fireEvent.click(await screen.findByRole("button", { name: /retry saving/i }));
    await waitFor(() => expect(api.submitScore).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.submitScore).mock.calls[0][1].batchId).toEqual(vi.mocked(api.submitScore).mock.calls[1][1].batchId);
    await waitFor(() => expect(screen.queryByRole("button", { name: /retry saving/i })).toBeNull());
  });
  it("returns a revoked linked device to a safe entry route", async () => {
    vi.mocked(api.getSession).mockResolvedValue(session(10000, "kid-one"));
    vi.mocked(api.kidHome).mockResolvedValue({ profile, decks: [privateDeck], totalPoints: 0 });
    vi.mocked(api.submitScore).mockRejectedValue(new ApiError("This device is no longer linked. Ask an adult for a new link.", 403));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    answer("Sun");
    expect(await screen.findByText(/this device is no longer linked/i)).toBeTruthy();
    expect(screen.queryByText("Our star?")).toBeNull();
    expect(screen.getByLabelText(/your nickname/i)).toBeTruthy();
  });
});


describe("automated learner accessibility checks", () => {
  it("checks the library, preview, question and feedback for detectable WCAG violations", async () => {
    const { container } = render(<App />);
    const check = async () => {
      const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, rules: { "color-contrast": { enabled: false } } });
      expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    };
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    await check();
    fireEvent.click(screen.getByRole("button", { name: /back to decks/i }));
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Sun" })); // chosen, not checked yet
    await check();
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    await check();
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    answer("Earth");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    await screen.findByText(/2 of 2 correct/i);
    await check();
  });
});

describe("guest review and retry", () => {
  it("shows correct answers without fabricating explanations and retries only missed questions", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    answer("Moon");
    expect(screen.getByText(/not quite/i)).toBeTruthy();
    expect(screen.getByText(/the answer is/i).textContent).toContain("Sun");
    expect(document.querySelector(".explanation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    answer("Earth");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    expect(await screen.findByRole("heading", { name: /1 of 2 correct/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /practice missed questions/i }));
    expect(await screen.findByRole("heading", { name: "Our star?" })).toBeTruthy();
    expect(screen.getByLabelText("Progress").textContent).toContain("1 / 1");
  });
});

describe("keyboard focus through the learning flow", () => {
  it("moves focus to feedback, the next question and the results heading", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Our star?" }));
    answer("Moon");
    expect(document.activeElement?.textContent).toContain("Not quite");
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Our planet?" }));
    answer("Earth");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    expect(document.activeElement).toBe(await screen.findByRole("heading", { name: /1 of 2 correct/i }));
  });
});

describe("focus when navigating between screens", () => {
  it("moves focus to library and preview headings after navigation", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Explore decks" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Explore decks" }));
    fireEvent.click(screen.getByRole("button", { name: "Study Space test" }));
    await screen.findByRole("heading", { name: "Space test" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Space test" }));
    fireEvent.click(screen.getByRole("button", { name: /back to decks/i }));
    await screen.findByRole("heading", { name: "Explore decks" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Explore decks" }));
  });
});

describe("answer details for a parent's Progress page", () => {
  it("records the answers tried before checking, with the time taken, for a kid profile", async () => {
    vi.mocked(api.getSession).mockResolvedValue(session(10000, "kid-1"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    expect(screen.getByRole("button", { name: /check answer/i }).hasAttribute("disabled")).toBe(true);

    // Choosing isn't answering: the learner can change their mind.
    fireEvent.click(screen.getByRole("button", { name: "Moon" }));
    expect(screen.getByRole("button", { name: "Moon" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Sun" }));
    expect(screen.getByRole("button", { name: "Moon" }).getAttribute("aria-pressed")).toBe("false");
    expect(api.submitScore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(screen.getByText(/that's right/i)).toBeTruthy();
    await waitFor(() => expect(api.submitScore).toHaveBeenCalledTimes(1));
    const [answers, options] = vi.mocked(api.submitScore).mock.calls[0];
    expect(answers).toEqual([true]);
    expect(options.details).toEqual([
      expect.objectContaining({ deckKey: "bundled:test", deckTitle: "Space test", question: "Our star?", difficulty: "medium", picks: [1, 0], answerIndex: 0, optionCount: 2, retry: false }),
    ]);
    expect(options.details?.[0].ms).toBeGreaterThanOrEqual(0);
  });

  it("sends a guest's answers as right or wrong only", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Study Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /start practice/i }));
    answer("Sun");
    await waitFor(() => expect(api.submitScore).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.submitScore).mock.calls[0][1].details).toBeUndefined();
  });
});
