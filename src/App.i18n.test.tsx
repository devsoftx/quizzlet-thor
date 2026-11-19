// @vitest-environment jsdom
// The app in Spanish: switching language, server messages, deck text marked with its language.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { api, ApiError, type SessionInfo } from "./api";
import { App } from "./App";
import { getLanguage, resetLanguage, setLanguage } from "./i18n";

vi.mock("./auth", () => ({ AUTH_MODE: "dev", useAccountAuth: () => ({ isLoaded: true, isSignedIn: false, signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("./library", async (original) => {
  const actual = await original<typeof import("./library")>();
  return {
    ...actual,
    loadBundledDecks: () => [
      {
        id: "bundled:space.yaml", fileName: "space.yaml", source: "bundled", ok: true,
        deck: { title: "Space test", language: "en", enabled: true, shuffle: false, shuffleOptions: false, cards: [{ question: "Our star?", options: ["Sun", "Moon"], answer: "Sun" }] },
      },
    ],
  };
});

const session = (): SessionInfo => ({ name: "Nova", points: 0, deadline: Date.now() + 600_000, profileId: null, sessionTag: "tag-one" });

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  vi.spyOn(api, "kidHome").mockResolvedValue(null);
  vi.spyOn(api, "getSession").mockResolvedValue(null);
  vi.spyOn(api, "getLeaderboard").mockResolvedValue({ top: [], you: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetLanguage();
  localStorage.clear();
});

describe("the language switch", () => {
  it("switches the whole screen to Spanish and back, and remembers it", async () => {
    render(<App />);
    expect(await screen.findByLabelText("Your nickname")).toBeTruthy();
    const switcher = screen.getByRole("group", { name: "Language" });
    fireEvent.click(within(switcher).getByRole("button", { name: "Español" }));

    expect(await screen.findByLabelText("Tu apodo")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Empezar a explorar/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Tabla de posiciones/ })).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
    expect(localStorage.getItem("quizzlet:language")).toBe("es");
    const spanishSwitch = screen.getByRole("group", { name: "Idioma" });
    expect(within(spanishSwitch).getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
    // Each language is named in itself, and marked so screen readers say it right.
    expect(within(spanishSwitch).getByRole("button", { name: "English" }).getAttribute("lang")).toBe("en");

    fireEvent.click(within(spanishSwitch).getByRole("button", { name: "English" }));
    expect(await screen.findByLabelText("Your nickname")).toBeTruthy();
    expect(getLanguage()).toBe("en");
  });

  it("shows the server's refusal in Spanish", async () => {
    setLanguage("es");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      (input instanceof Request ? input.url : input.toString()).startsWith("/api/session")
        ? new Response(JSON.stringify({ error: "That nickname is taken. Please pick another one." }), { status: 409 })
        : new Response("null"),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Tu apodo"), { target: { value: "Nova" } });
    fireEvent.click(screen.getByRole("button", { name: /Empezar a explorar/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Ese apodo ya está en uso. Por favor, elige otro.");
  });

  it("marks English deck text as English when the app is in Spanish", async () => {
    setLanguage("es");
    vi.mocked(api.getSession).mockResolvedValue(session());
    render(<App />);
    const title = await screen.findByRole("heading", { name: "Space test" });
    expect(title.getAttribute("lang")).toBe("en");
    expect(screen.getByText("Inglés")).toBeTruthy(); // the deck's language, since it isn't the app's
    expect(screen.getByText("1 pregunta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Estudiar Space test" }));
    fireEvent.click(await screen.findByRole("button", { name: /Empezar a practicar/ }));
    expect(screen.getByRole("heading", { name: "Our star?" }).getAttribute("lang")).toBe("en");
    expect(screen.getByRole("button", { name: "Sun" }).querySelector("[lang='en']")).toBeTruthy();
  });
});

describe("server messages in Spanish", () => {
  it("translates the message but keeps the server's words for the app's own checks", async () => {
    setLanguage("es");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "This device is no longer linked. Ask an adult for a new link." }), { status: 403 }),
    );
    const err = await api.submitScore([true], { streakBefore: 0, leaderboard: false, sessionTag: "t", batchId: "b" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Este dispositivo ya no está vinculado. Pídele a un adulto un enlace nuevo.");
    expect((err as ApiError).serverMessage).toBe("This device is no longer linked. Ask an adult for a new link.");
  });

  it("words the app's own connection problems in Spanish", async () => {
    setLanguage("es");
    vi.mocked(api.getLeaderboard).mockRestore(); // the real call this time
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.getLeaderboard()).rejects.toThrow("No se puede conectar con el servidor. Revisa tu conexión a internet.");
  });
});

describe("the main page's footer", () => {
  it("credits its maker with a heart and a link, in either language", async () => {
    render(<App />);
    const footer = (await screen.findByText(/Made with Love/)).closest("footer")!;
    expect(footer.textContent).toBe("Made with Love  in Prince Frederick, MD by FR.COM (opens in a new tab)");
    expect(footer.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const link = within(footer).getByRole("link", { name: "FR.COM (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://fabriciorojas.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect((await screen.findByText(/Hecho con amor/)).closest("footer")!.textContent).toBe(
      "Hecho con amor  en Prince Frederick, MD por FR.COM (se abre en una pestaña nueva)",
    );
  });
});
