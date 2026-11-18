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
import type { Deps } from "./deps.js";
import { accountFolder } from "./files.js";
import { error, json, readJson } from "./http.js";
import { noLog } from "./log.js";
import { checkName, cleanName, nameProblemMessage } from "./names.js";
import { route } from "./route.js";

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
  let failed = false;
  try {
    user = await auth.authenticate(request);
  } catch {
    failed = true;
  }
  if (!user) {
    // "missing": nothing to check was sent. "rejected": a sign-in was sent and didn't hold up.
    const sent = request.headers.has("authorization") || request.headers.has("x-dev-user") || /(?:^|;\s*)__session=/.test(request.headers.get("cookie") ?? "");
    (deps.log ?? noLog)({ event: "auth.failed", reason: failed ? "error" : sent ? "rejected" : "missing", path: new URL(request.url).pathname });
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
  return ctx.scope.ensure({ displayName });
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
export const getMe = route({ name: "me.get" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const account = await ensureAccount(ctx, deps);
  const profiles = await ctx.scope.listProfiles();
  return json({
    account: { displayName: account.displayName, plan: account.plan, settings: account.settings },
    profiles,
    points: await profilePoints(deps, profiles.map((p) => p.id)),
  });
});

/** PATCH {displayName?, settings?}: update the account. */
export const updateMe = route({ name: "me.update" }, async (request, deps) => {
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
});

/**
 * DELETE {confirm: true}: delete the account's stored files, then the account
 * with its profiles, decks and file records, their leaderboard entries, and
 * finally the sign-in.
 */
export const deleteMe = route({ name: "me.delete" }, async (request, deps) => {
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
  (deps.log ?? noLog)({ event: "account.deleted", account: ctx.userId, profiles: profileIds.length });
  await deps.auth!.deleteUser(ctx.userId); // data first, so a failure here can be retried
  return json({ ok: true, deletedProfiles: profileIds.length });
});

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

export const listProfiles = route({ name: "profiles.list" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return json({ profiles: await ctx.scope.listProfiles() });
});

const TOO_MANY_PROFILES = `You can have up to ${MAX_PROFILES} profiles.`;

export const createProfile = route({ name: "profiles.create" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const parsed = parseProfileInput((await readJson(request)) ?? {}, true);
  if (typeof parsed === "string") return error(400, parsed);

  const existing = await ctx.scope.listProfiles();
  if (existing.length >= MAX_PROFILES) return error(400, TOO_MANY_PROFILES);
  const n = existing.length;
  // The count above picks the default color; the insert itself enforces the limit.
  const profile = await ctx.scope.createProfile(deps.newId(), {
    nickname: parsed.nickname!,
    gradeBand: parsed.gradeBand ?? null,
    color: parsed.color ?? PROFILE_COLORS[n % PROFILE_COLORS.length],
    emoji: parsed.emoji ?? PROFILE_EMOJIS[n % PROFILE_EMOJIS.length],
    showOnLeaderboard: parsed.showOnLeaderboard ?? false, // private unless the parent opts in
  });
  if (!profile) return error(400, TOO_MANY_PROFILES);
  return json({ profile }, 201);
});

export const updateProfile = route({ name: "profiles.update" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const parsed = parseProfileInput((await readJson(request)) ?? {}, false);
  if (typeof parsed === "string") return error(400, parsed);

  const profile: KidProfile | null = await ctx.scope.updateProfile(idParam(request), parsed);
  if (!profile) return error(404, "Profile not found.");
  await deps.store?.syncPlayer(playerKeyForProfile(profile.id), profile.nickname, profile.showOnLeaderboard);
  return json({ profile });
});

export const deleteProfile = route({ name: "profiles.delete" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const id = idParam(request);
  if (!(await ctx.scope.deleteProfile(id))) return error(404, "Profile not found.");
  await deps.store?.removePlayer(playerKeyForProfile(id));
  (deps.log ?? noLog)({ event: "profile.deleted", account: ctx.userId, profile: id });
  return json({ ok: true });
});
