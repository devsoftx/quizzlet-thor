export type Env = Record<string, string | undefined>;

/**
 * True only on a developer's machine: not a Vercel deployment and not a
 * production build. The in-memory stores and the local sign-in stand-in are
 * allowed nowhere else.
 */
export const isLocalDev = (env: Env): boolean => !env.VERCEL && env.NODE_ENV !== "production";
