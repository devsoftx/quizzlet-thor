// Parent/teacher sign-in for the browser. One interface, three modes:
//  - "clerk": Clerk (Google sign-in) when a Clerk publishable key is set
//  - "dev":   a local stand-in during `npm run dev` without Clerk keys
//  - "off":   accounts aren't available; guest mode only

import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { setAuthHeaders } from "./api";

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
export const useAccountAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (AUTH_MODE === "clerk") {
    return (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY!} afterSignOutUrl="/">
        <ClerkBridge>{children}</ClerkBridge>
      </ClerkProvider>
    );
  }
  if (AUTH_MODE === "dev") return <DevAuth>{children}</DevAuth>;
  return <AuthContext.Provider value={OFF}>{children}</AuthContext.Provider>;
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
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
  return <AuthContext.Provider value={value}>{children}{showSignIn && <div className="dev-signin" role="dialog" aria-modal="true" aria-labelledby="dev-signin-title" onKeyDown={(e) => {
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
      <h2 id="dev-signin-title">Local test sign-in</h2>
      <p>This is a disposable local account, not a real sign-in.</p>
      <label htmlFor="dev-parent-id">Parent test ID</label>
      <input id="dev-parent-id" value={devId} onChange={(e) => setDevId(e.target.value)} pattern="[A-Za-z0-9-]{1,40}" required autoFocus />
      <div><button className="btn btn--primary" type="submit">Continue</button> <button className="btn btn--secondary" type="button" onClick={() => setShowSignIn(false)}>Cancel</button></div>
    </form>
  </div>}</AuthContext.Provider>;
}
