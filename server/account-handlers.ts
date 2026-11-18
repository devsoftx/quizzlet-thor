// /api/me and /api/profiles: parent/teacher accounts and their kids' profiles.
// Every request is tied to the verified sign-in; data is reached only through
// accounts.forAccount(<that user id>), so one account can never see another's.

import {
  DEFAULT_SETTINGS,
  GRADE_BANDS,
  LimitReached,
  MAX_PROFILES,
  normalizeSettings,
  PROFILE_COLORS,
  PROFILE_EMOJIS,
  type AccountScope,
  type KidProfile,
  type ProfileInput,
} from "./accounts.js";
import { defaultDeps, type Deps } from "./deps.js";
import { accountFolder } from "./files.js";
import { cleanName, error, json, readJson } from "./http.js";
import { checkName, nameProblemMessage } from "./names.js";
import { errorName, routeOf, securityEvent } from "./log.js";

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
  } catch (err) {
    // The sign-in provider failed (not the visitor): answered like "signed out", but never silently.
    securityEvent("auth.error", { route: routeOf(request), errorName: errorName(err) });
    return error(401, "Please sign in.");
  }
  if (!user) {
    securityEvent("auth.denied", { route: routeOf(request) });
    return error(401, "Please sign in.");
  }
  return { userId: user.userId, scope: accounts.forAccount(user.userId) };
}

/** The account row, created on first use with a name from the sign-in provider. */
export async function ensureAccount(ctx: AccountContext, deps: Deps) {
  const existing = await ctx.scope.get();
  if (existing) return existing;
  let displayName = "Parent";
  try {
    displayName = cleanName((await deps.auth!.describeUser(ctx.userId)).displayName) ?? displayName;
  } catch {
    // keep the default
  }
  const account = await ctx.scope.ensure({ displayName });
  securityEvent("account.created", { accountId: ctx.userId });
  return account;
}

const playerKeyForProfile = (id: string) => `p:${id}`;

/** Each kid profile's all-time points (0 when there's no leaderboard store). */
export async function profilePoints(deps: Deps, profileIds: string[]): Promise<Record<string, number>> {
  if (!deps.store || profileIds.length === 0) return Object.fromEntries(profileIds.map((id) => [id, 0]));
  const totals = await deps.store.totalsFor(profileIds.map(playerKeyForProfile));
  return Object.fromEntries(profileIds.map((id) => [id, totals[playerKeyForProfile(id)] ?? 0]));
}

const idParam = (request: Request) => new URL(request.url).searchParams.get("id") ?? "";

// ----------------------------------------------------------------- /api/me

/** GET: the account (created on first sign-in) and its kid profiles. */
export async function getMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const account = await ensureAccount(ctx, deps);
  const profiles = await ctx.scope.listProfiles();
  return json({
    account: { displayName: account.displayName, plan: account.plan, settings: account.settings },
    profiles,
    points: await profilePoints(deps, profiles.map((p) => p.id)),
  });
}

/** PATCH {displayName?, settings?}: update the account. */
export async function updateMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const current = await ensureAccount(ctx, deps);
  const body = (await readJson(request)) ?? {};

  const patch: { displayName?: string; settings?: typeof DEFAULT_SETTINGS } = {};
  if (body.displayName !== undefined) {
    const checked = checkName(body.displayName);
    if (!checked.ok) return error(400, nameProblemMessage(checked.problem, "name"));
    patch.displayName = checked.name;
  }
  if (body.settings !== undefined) {
    patch.settings = normalizeSettings({ ...current.settings, ...(body.settings as object) });
  }
  const account = await ctx.scope.update(patch);
  if (!account) return error(404, "Account not found.");
  return json({ account: { displayName: account.displayName, plan: account.plan, settings: account.settings } });
}

/**
 * DELETE {confirm: true}: delete the account's stored files, then the account
 * with its profiles, decks and file records, their leaderboard entries, and
 * finally the sign-in.
 */
export async function deleteMe(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (body?.confirm !== true) return error(400, "Confirm the deletion to continue.");

  // Files first: if this fails, nothing else is gone yet and the parent can retry.
  await deps.files?.deletePrefix(accountFolder(ctx.userId));
  const profileIds = await ctx.scope.remove();
  if (deps.store) {
    for (const id of profileIds) await deps.store.removePlayer(playerKeyForProfile(id));
  }
  securityEvent("account.deleted", { accountId: ctx.userId, deletedProfiles: profileIds.length });
  await deps.auth!.deleteUser(ctx.userId); // data first, so a failure here can be retried
  return json({ ok: true, deletedProfiles: profileIds.length });
}

// ----------------------------------------------------------- /api/profiles

type ProfilePatch = Partial<ProfileInput>;

/** Validates profile fields; `requireNickname` for creation. Returns the patch or an error message. */
export function parseProfileInput(body: Record<string, unknown>, requireNickname: boolean): ProfilePatch | string {
  const out: ProfilePatch = {};
  if (body.nickname !== undefined || requireNickname) {
    const checked = checkName(body.nickname);
    if (!checked.ok) return nameProblemMessage(checked.problem);
    out.nickname = checked.name;
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

  const tooMany = () => error(400, `You can have up to ${MAX_PROFILES} profiles.`);
  const existing = await ctx.scope.listProfiles();
  if (existing.length >= MAX_PROFILES) return tooMany();
  const n = existing.length;
  let profile: KidProfile;
  try {
    profile = await ctx.scope.createProfile(deps.newId(), {
      nickname: parsed.nickname!,
      gradeBand: parsed.gradeBand ?? null,
      color: parsed.color ?? PROFILE_COLORS[n % PROFILE_COLORS.length],
      emoji: parsed.emoji ?? PROFILE_EMOJIS[n % PROFILE_EMOJIS.length],
      showOnLeaderboard: parsed.showOnLeaderboard ?? false, // private unless the parent opts in
    });
  } catch (err) {
    // The database enforces the limit too: parallel requests can pass the check above together.
    if (err instanceof LimitReached) return tooMany();
    throw err;
  }
  securityEvent("profile.created", { accountId: ctx.userId, profileId: profile.id, listed: profile.showOnLeaderboard });
  return json({ profile }, 201);
}

export async function updateProfile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const parsed = parseProfileInput((await readJson(request)) ?? {}, false);
  if (typeof parsed === "string") return error(400, parsed);

  const profile: KidProfile | null = await ctx.scope.updateProfile(idParam(request), parsed);
  if (!profile) return error(404, "Profile not found.");
  await deps.store?.syncPlayer(playerKeyForProfile(profile.id), profile.nickname, profile.showOnLeaderboard, profile.emoji);
  if (parsed.showOnLeaderboard !== undefined) {
    securityEvent("profile.visibility", { accountId: ctx.userId, profileId: profile.id, listed: profile.showOnLeaderboard });
  }
  return json({ profile });
}

export async function deleteProfile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const id = idParam(request);
  if (!(await ctx.scope.deleteProfile(id))) return error(404, "Profile not found.");
  await deps.store?.removePlayer(playerKeyForProfile(id));
  securityEvent("profile.deleted", { accountId: ctx.userId, profileId: id });
  return json({ ok: true });
}
