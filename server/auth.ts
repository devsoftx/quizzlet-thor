import { createClerkClient } from "@clerk/backend";

/** A signed-in parent or teacher. Kids never have accounts of their own. */
export interface AuthUser {
  userId: string;
}

export interface Authenticator {
  /** The signed-in user for this request, or null if signed out. */
  authenticate(request: Request): Promise<AuthUser | null>;
  /** A friendly name to start a new account with (never shown publicly). */
  describeUser(userId: string): Promise<{ displayName: string }>;
  /** Removes the sign-in account itself ("Delete my account"). */
  deleteUser(userId: string): Promise<void>;
}

type Env = Record<string, string | undefined>;

/** Origins allowed to present Clerk session tokens to the API. */
export function authorizedParties(env: Env): string[] {
  const parties = new Set<string>();
  for (const key of ["VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL", "VERCEL_URL"]) {
    const host = env[key];
    if (host) parties.add(`https://${host}`);
  }
  if (!env.VERCEL) {
    for (const port of [5173, 5174, 4173]) parties.add(`http://localhost:${port}`);
  }
  return [...parties];
}

export class ClerkAuthenticator implements Authenticator {
  private clerk: ReturnType<typeof createClerkClient>;

  constructor(
    secretKey: string,
    publishableKey: string | undefined,
    private parties: string[],
  ) {
    this.clerk = createClerkClient({ secretKey, publishableKey });
  }

  async authenticate(request: Request): Promise<AuthUser | null> {
    const state = await this.clerk.authenticateRequest(request, {
      authorizedParties: this.parties,
    });
    if (!state.isAuthenticated) return null;
    const userId = state.toAuth()?.userId;
    return userId ? { userId } : null;
  }

  async describeUser(userId: string) {
    const user = await this.clerk.users.getUser(userId);
    return { displayName: user.firstName?.trim() || "Parent" };
  }

  async deleteUser(userId: string) {
    await this.clerk.users.deleteUser(userId);
  }
}

/**
 * Local development only: the browser sends `x-dev-user: <id>` to act as a
 * signed-in parent, so the whole flow (and two separate parents) can be tried
 * without Clerk keys. Never used on Vercel.
 */
export class DevAuthenticator implements Authenticator {
  static readonly HEADER = "x-dev-user";

  async authenticate(request: Request): Promise<AuthUser | null> {
    const id = request.headers.get(DevAuthenticator.HEADER)?.trim();
    return id && /^[a-z0-9-]{1,40}$/i.test(id) ? { userId: `dev_${id}` } : null;
  }

  async describeUser(userId: string) {
    return { displayName: userId.replace(/^dev_/, "") };
  }

  async deleteUser(_userId: string) {}
}

/**
 * Clerk when its secret key is set; the dev stand-in when running locally with
 * QUIZZLET_DEV_AUTH=1 (the Vite dev server sets it); otherwise accounts are off.
 */
export function getAuthenticator(env: Env = process.env): Authenticator | null {
  if (env.CLERK_SECRET_KEY) {
    const publishableKey =
      env.VITE_CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY;
    return new ClerkAuthenticator(env.CLERK_SECRET_KEY, publishableKey, authorizedParties(env));
  }
  if (!env.VERCEL && env.QUIZZLET_DEV_AUTH === "1") return new DevAuthenticator();
  return null;
}
