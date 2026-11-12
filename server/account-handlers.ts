// /api/me and /api/profiles: parent/teacher accounts and their kids' profiles.
// Every request is tied to the verified sign-in; data is reached only through
// accounts.forAccount(<that user id>), so one account can never see another's.

import {
  DEFAULT_SETTINGS,
  GRADE_BANDS,
  MAX_PROFILES,
  normalizeSettings,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  type AccountScope,
  type KidProfile,
  type ProfileInput,
} from "./accounts.js";
import { defaultDeps, type Deps } from "./deps.js";
import { cleanName, error, json, NAME_MAX, readJson } from "./http.js";

export interface AccountContext {
  userId: string;
  scope: AccountScope;
}

/** The signed-in account for this request, or the error response to return. */
export async function requireAccount(request: Request, deps: Deps): Promise<AccountContext | Response> {
  const auth = deps.auth ?? null;
  const accounts = deps.accounts ?? null;
  if (!auth || !accounts) return error(503, "Parent accounts aren't set up yet.");
  let user = null;
  try {
    user = await auth.authenticate(request);
  } catch {
    user = null;
  }
  if (!user) return error(401, "Please sign in.");
  return { userId: user.userId, scope: accounts.forAccount(user.userId) };
}

/** The account row, created on first use with a name from the sign-in provider. */
async function ensureAccount(ctx: AccountContext, deps: Deps) {
  const existing = await ctx.scope.get();
  if (existing) return existing;
  let displayName = "Parent";
  try {
    displayName = cleanName((await deps.auth!.describeUser(ctx.userId)).displayName) ?? displayName;
  } catch {
    // keep the default
  }
  return ctx.scope.ensure({ displayName });
}

const playerKeyForProfile = (id: string) => `p:${id}`;

const idParam = (request: Request) => new URL(request.url).searchParams.get("id") ?? "";

// ----------------------------------------------------------------- /api/me

/** GET: the account (created on first sign-in) and its kid profiles. */
export async function getMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const account = await ensureAccount(ctx, deps);
  const profiles = await ctx.scope.listProfiles();
  return json({ account: { displayName: account.displayName, plan: account.plan, settings: account.settings }, profiles });
}

/** PATCH {displayName?, settings?}: update the account. */
export async function updateMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const current = await ensureAccount(ctx, deps);
  const body = (await readJson(request)) ?? {};

  const patch: { displayName?: string; settings?: typeof DEFAULT_SETTINGS } = {};
  if (body.displayName !== undefined) {
    const name = cleanName(body.displayName);
    if (!name) return error(400, `Please enter a name (up to ${NAME_MAX} letters, numbers or spaces).`);
    patch.displayName = name;
  }
  if (body.settings !== undefined) {
    patch.settings = normalizeSettings({ ...current.settings, ...(body.settings as object) });
  }
  const account = await ctx.scope.update(patch);
  if (!account) return error(404, "Account not found.");
  return json({ account: { displayName: account.displayName, plan: account.plan, settings: account.settings } });
}

/** DELETE {confirm: true}: delete the account, its profiles and their leaderboard entries, then the sign-in. */
export async function deleteMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (body?.confirm !== true) return error(400, "Confirm the deletion to continue.");

  const profileIds = await ctx.scope.remove();
  if (deps.store) {
    for (const id of profileIds) await deps.store.removePlayer(playerKeyForProfile(id));
  }
  await deps.auth!.deleteUser(ctx.userId); // data first, so a failure here can be retried
  return json({ ok: true, deletedProfiles: profileIds.length });
}

// ----------------------------------------------------------- /api/profiles

type ProfilePatch = Partial<ProfileInput>;

/** Validates profile fields; `requireNickname` for creation. Returns the patch or an error message. */
export function parseProfileInput(body: Record<string, unknown>, requireNickname: boolean): ProfilePatch | string {
  const out: ProfilePatch = {};
  if (body.nickname !== undefined || requireNickname) {
    const nickname = cleanName(body.nickname);
    if (!nickname) return `Please enter a nickname (up to ${NAME_MAX} letters, numbers or spaces).`;
    out.nickname = nickname;
  }
  if (body.gradeBand !== undefined) {
    if (body.gradeBand !== null && !GRADE_BANDS.includes(body.gradeBand as never)) return "Unknown grade band.";
    out.gradeBand = body.gradeBand as ProfileInput["gradeBand"];
  }
  if (body.color !== undefined) {
    if (!PROFILE_COLORS.includes(body.color as never)) return "Unknown color.";
    out.color = body.color as string;
  }
  if (body.emoji !== undefined) {
    if (!PROFILE_EMOJIS.includes(body.emoji as never)) return "Unknown emoji.";
    out.emoji = body.emoji as string;
  }
  if (body.showOnLeaderboard !== undefined) {
    if (typeof body.showOnLeaderboard !== "boolean") return "showOnLeaderboard must be true or false.";
    out.showOnLeaderboard = body.showOnLeaderboard;
  }
  return out;
}

export async function listProfiles(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return json({ profiles: await ctx.scope.listProfiles() });
}

export async function createProfile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const parsed = parseProfileInput((await readJson(request)) ?? {}, true);
  if (typeof parsed === "string") return error(400, parsed);

  const existing = await ctx.scope.listProfiles();
  if (existing.length >= MAX_PROFILES) return error(400, `You can have up to ${MAX_PROFILES} profiles.`);
  const n = existing.length;
  const profile = await ctx.scope.createProfile(deps.newId(), {
    nickname: parsed.nickname!,
    gradeBand: parsed.gradeBand ?? null,
    color: parsed.color ?? PROFILE_COLORS[n % PROFILE_COLORS.length],
    emoji: parsed.emoji ?? PROFILE_EMOJIS[n % PROFILE_EMOJIS.length],
    showOnLeaderboard: parsed.showOnLeaderboard ?? false, // private unless the parent opts in
  });
  return json({ profile }, 201);
}

export async function updateProfile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const parsed = parseProfileInput((await readJson(request)) ?? {}, false);
  if (typeof parsed === "string") return error(400, parsed);

  const profile: KidProfile | null = await ctx.scope.updateProfile(idParam(request), parsed);
  if (!profile) return error(404, "Profile not found.");
  await deps.store?.syncPlayer(playerKeyForProfile(profile.id), profile.nickname, profile.showOnLeaderboard);
  return json({ profile });
}

export async function deleteProfile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const id = idParam(request);
  if (!(await ctx.scope.deleteProfile(id))) return error(404, "Profile not found.");
  await deps.store?.removePlayer(playerKeyForProfile(id));
  return json({ ok: true });
}
