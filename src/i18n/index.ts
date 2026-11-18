// The app's language: English or Spanish.
//
// One choice per device, kept in localStorage, so it works the same for guests,
// kids on their own linked device and signed-in parents. With no choice saved,
// the browser's preferred languages decide (Spanish if it comes first among the
// two), else English. The choice also sets <html lang>, so screen readers speak
// the page in the right voice.
//
// A tiny store rather than a React context: the API client (src/api.ts) needs
// the language outside React, and components need no provider to use it.
import { useSyncExternalStore } from "react";
import { en, type Messages } from "./en";
import { es } from "./es";

export const LANGUAGES = ["en", "es"] as const;
export type Language = (typeof LANGUAGES)[number];
export type { Messages };

const CATALOGS: Record<Language, Messages> = { en, es };
export const LANGUAGE_KEY = "quizzlet:language";

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

function savedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null; // storage blocked: fall back to the browser's languages
  }
}

/** The first of the browser's preferred languages that the app speaks. */
export function browserLanguage(preferred: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): Language {
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

let current: Language = savedLanguage() ?? browserLanguage();
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
applyToDocument();

function update(language: Language) {
  if (language === current) return;
  current = language;
  applyToDocument();
  for (const listener of listeners) listener();
}

/** The language in use right now. */
export const getLanguage = (): Language => current;

/** The messages for a language (the current one by default). */
export const messagesFor = (language: Language = current): Messages => CATALOGS[language];

/** Switch the app's language on this device and remember it. */
export function setLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Not remembered, but still switched for this visit.
  }
  update(language);
}

/** Forget the saved choice (tests); the browser's languages decide again. */
export function resetLanguage(): void {
  try {
    localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    // ignore
  }
  update(browserLanguage());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A choice made in another tab applies here too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LANGUAGE_KEY && isLanguage(e.newValue)) update(e.newValue);
  });
}

/** The current language and its messages; re-renders when the language changes. */
export function useI18n() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { language, t: CATALOGS[language], setLanguage };
}

/** "18 nov" / "Nov 18", in the current language. */
export function formatDate(iso: string, options: Intl.DateTimeFormatOptions, language: Language = current): string {
  return new Date(iso).toLocaleDateString(CATALOGS[language].locale, options);
}

/**
 * A language's name, in the app's language ("Spanish", "inglés"), for deck
 * languages. Falls back to the code itself.
 */
export function languageName(code: string, language: Language = current): string {
  try {
    const name = new Intl.DisplayNames([CATALOGS[language].locale], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(CATALOGS[language].locale) + name.slice(1) : code;
  } catch {
    return code;
  }
}
