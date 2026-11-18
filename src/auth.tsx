// Parent/teacher sign-in for the browser. One interface, three modes:
//  - "clerk": Clerk (Google sign-in) when a Clerk publishable key is set
//  - "dev":   a local stand-in during `npm run dev` without Clerk keys
//  - "off":   accounts aren't available; guest mode only

/* eslint-disable react-refresh/only-export-components -- the mode, the hook and the provider stay together here; editing this file reloads the page in dev */

import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { esMX } from "@clerk/localizations/es-MX";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { setAuthHeaders } from "./api";
import { useI18n } from "./i18n";

export type AuthMode = "clerk" | "dev" | "off";

export interface AccountAuth {
  mode: AuthMode;
  isLoaded: boolean;
  isSignedIn: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
}

// VITE_… if you set it yourself; NEXT_PUBLIC_… when it comes from Clerk's Vercel integration.
const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ??
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) as string | undefined;
export const AUTH_MODE: AuthMode = PUBLISHABLE_KEY ? "clerk" : import.meta.env.DEV ? "dev" : "off";

const OFF: AccountAuth = {
  mode: "off",
  isLoaded: true,
  isSignedIn: false,
  signIn: () => undefined,
  signOut: async () => undefined,
};

const AuthContext = createContext<AccountAuth>(OFF);
export const useAccountAuth = () => use(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Clerk's sign-in window follows the app's language (Latin American Spanish).
  const { language } = useI18n();
  if (AUTH_MODE === "clerk") {
    return (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" localization={language === "es" ? esMX : undefined}>
        <ClerkBridge>{children}</ClerkBridge>
      </ClerkProvider>
    );
  }
  if (AUTH_MODE === "dev") return <DevAuth>{children}</DevAuth>;
  return <AuthContext value={OFF}>{children}</AuthContext>;
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();

  // Set during render (not in an effect): child effects run first, and their
  // first API calls must already carry the sign-in.
  setAuthHeaders(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  });

  const value = useMemo<AccountAuth>(
    () => ({
      mode: "clerk",
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      signIn: () => clerk.openSignIn(),
      signOut: () => clerk.signOut(),
    }),
    [isLoaded, isSignedIn, clerk],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

// --------------------------------------------------------------- Dev mode
// Pretends to be a signed-in parent by sending `x-dev-user` (the dev server
// only honors it locally). Use different ids to try two separate parents.

const DEV_USER_KEY = "quizzlet:dev-user";

function readDevUser(): string | null {
  try {
    return localStorage.getItem(DEV_USER_KEY);
  } catch {
    return null;
  }
}

function DevAuth({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [user, setUser] = useState<string | null>(readDevUser);
  const [showSignIn, setShowSignIn] = useState(false);
  const [devId, setDevId] = useState("parent-a");

  setAuthHeaders(async (): Promise<Record<string, string>> => (user ? { "x-dev-user": user } : {}));

  const value = useMemo<AccountAuth>(
    () => ({
      mode: "dev",
      isLoaded: true,
      isSignedIn: Boolean(user),
      signIn: () => setShowSignIn(true),
      signOut: async () => {
        try {
          localStorage.removeItem(DEV_USER_KEY);
        } catch {
          // ignore
        }
        setUser(null);
      },
    }),
    [user],
  );
  return <AuthContext value={value}>{children}{showSignIn && <div className="dev-signin" role="dialog" aria-modal="true" aria-labelledby="dev-signin-title" onKeyDown={(e) => {
    if (e.key === "Escape") { setShowSignIn(false); return; }
    if (e.key !== "Tab") return;
    const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])')];
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }}>
    <form className="dev-signin__form" onSubmit={(e) => {
      e.preventDefault();
      if (!/^[a-z0-9-]{1,40}$/i.test(devId)) return;
      try { localStorage.setItem(DEV_USER_KEY, devId); } catch { /* local session only */ }
      setUser(devId);
      setShowSignIn(false);
    }}>
      <h2 id="dev-signin-title">{t.devSignIn.title}</h2>
      <p>{t.devSignIn.text}</p>
      <label htmlFor="dev-parent-id">{t.devSignIn.parentId}</label>
      <input id="dev-parent-id" value={devId} onChange={(e) => setDevId(e.target.value)} pattern="[A-Za-z0-9-]{1,40}" required autoFocus />
      <div><button className="btn btn--primary" type="submit">{t.devSignIn.continue}</button> <button className="btn btn--secondary" type="button" onClick={() => setShowSignIn(false)}>{t.common.cancel}</button></div>
    </form>
  </div>}</AuthContext>;
}
