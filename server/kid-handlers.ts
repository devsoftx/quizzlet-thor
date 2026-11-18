// Kid device links. A parent makes a one-time invitation link for a kid
// profile; opening it on the kid's own device links that device to the
// profile with a long-lived HttpOnly cookie. Kids never get an account, an
// email or a password, and a linked device can only reach its own profile.
//
// Secrets (invitation tokens, device cookies) are 256-bit random strings; only
// their SHA-256 fingerprints are stored.

import { createHash, randomBytes } from "node:crypto";
import {
  deckIsFor,
  INVITE_DAYS,
  MAX_DEVICES_PER_PROFILE,
  type AccountsDb,
  type KidCard,
  type KidProfile,
  type LinkTarget,
} from "./accounts.js";
import { profilePoints, requireAccount } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { cookie, error, json, readCookie, readJson } from "./http.js";
import { securityEvent } from "./log.js";

export const KID_COOKIE = "qz_kid";
const DEVICE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const LINK_GONE = "This link has expired or was already used. Ask your parent for a new one.";

const newSecret = () => randomBytes(32).toString("base64url");
export const fingerprint = (secret: string) => createHash("sha256").update(secret).digest("hex");
const isSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const iso = (ms: number) => new Date(ms).toISOString();

const card = (p: KidProfile): KidCard => ({ id: p.id, nickname: p.nickname, emoji: p.emoji, color: p.color });

/** A short, non-identifying name for a device, from its browser. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Windows/.test(ua)
            ? "Windows"
            : /Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return browser ? `${device} · ${browser}` : device;
}

/** The kid device linked to this browser, if any. */
export async function kidDevice(request: Request, deps: Deps): Promise<(LinkTarget & { id: string }) | null> {
  const secret = readCookie(request, KID_COOKIE);
  if (!isSecret(secret) || !deps.accounts) return null;
  return deps.accounts.findDevice(fingerprint(secret), iso(deps.now()));
}

/** The profile a linked kid device studies as, or null. */
export async function kidProfile(request: Request, deps: Deps): Promise<KidProfile | null> {
  const device = await kidDevice(request, deps);
  if (!device) return null;
  return deps.accounts!.forAccount(device.accountId).getProfile(device.profileId);
}

/** Logs a device that was just unlinked from its own side (`by`: the kid, or a new link replacing it). */
function unlinked(device: (LinkTarget & { id: string }) | null, by: "kid" | "replaced") {
  if (device) securityEvent("device.unlinked", { accountId: device.accountId, profileId: device.profileId, deviceId: device.id, by });
}

async function devicesFor(accounts: AccountsDb, target: LinkTarget) {
  return (await accounts.forAccount(target.accountId).listDevices()).filter((d) => d.profileId === target.profileId);
}

// ------------------------------------------------- /api/invites (parents)

/** GET: open invitations and linked devices for all of the account's kids. */
export async function listLinks(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return json({ invites: await ctx.scope.listInvites(iso(deps.now())), devices: await ctx.scope.listDevices() });
}

/**
 * POST {profileId}: a new invitation link for a kid (replacing any earlier one).
 * The token is returned once; the browser builds the link around it.
 */
export async function createInvite(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(request)) ?? {};
  const profile = typeof body.profileId === "string" ? await ctx.scope.getProfile(body.profileId) : null;
  if (!profile) return error(404, "Profile not found.");
  const linked = (await ctx.scope.listDevices()).filter((d) => d.profileId === profile.id);
  if (linked.length >= MAX_DEVICES_PER_PROFILE) {
    return error(400, `${profile.nickname} already has ${MAX_DEVICES_PER_PROFILE} devices. Remove one first.`);
  }

  const token = newSecret();
  const now = deps.now();
  const invite = await ctx.scope.createInvite(profile.id, fingerprint(token), iso(now), iso(now + INVITE_DAYS * DAY_MS));
  securityEvent("invite.created", { accountId: ctx.userId, profileId: profile.id });
  return json({ token, invite }, 201);
}

/** DELETE ?profileId=: cancel a kid's open link. DELETE ?deviceId=: unlink one of their devices. */
export async function deleteLink(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const params = new URL(request.url).searchParams;
  const deviceId = params.get("deviceId");
  if (deviceId) {
    const device = await ctx.scope.deleteDevice(deviceId);
    if (!device) return error(404, "Device not found.");
    securityEvent("device.unlinked", { accountId: ctx.userId, profileId: device.profileId, deviceId: device.id, by: "parent" });
    return json({ ok: true });
  }
  const profile = await ctx.scope.getProfile(params.get("profileId") ?? "");
  if (!profile) return error(404, "Profile not found.");
  if (await ctx.scope.cancelInvites(profile.id)) {
    securityEvent("invite.cancelled", { accountId: ctx.userId, profileId: profile.id });
  }
  return json({ ok: true });
}

// ------------------------------------------------------ /api/kid (kids)

/** GET: who this device studies as, and the parent's decks meant for them ({kid: null} if not linked). */
export async function getKid(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const hadCookie = readCookie(request, KID_COOKIE) !== null;
  const device = await kidDevice(request, deps);
  const profile = device ? await deps.accounts!.forAccount(device.accountId).getProfile(device.profileId) : null;
  if (!device || !profile) {
    // Unlinked (or removed by the parent): forget the stale cookie.
    return json({ kid: null }, 200, hadCookie ? { "set-cookie": cookie(request, KID_COOKIE, "", 0) } : {});
  }
  const decks = (await deps.accounts!.forAccount(device.accountId).listDecks()).filter((d) => deckIsFor(d, profile.id));
  const totalPoints = (await profilePoints(deps, [profile.id]))[profile.id];
  return json({ kid: { profile: card(profile), decks, totalPoints } });
}

/**
 * POST {action: "peek", token}: whose invitation this is (before joining).
 * POST {action: "join", token}: use up the invitation and link this device.
 */
export async function postKid(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const accounts = deps.accounts ?? null;
  if (!accounts) return error(503, "Kid links aren't set up yet.");
  const body = (await readJson(request)) ?? {};
  const action = body.action === "peek" || body.action === "join" ? body.action : "other";
  const miss = () => {
    securityEvent("invite.miss", { action });
    return error(404, LINK_GONE);
  };
  if (!isSecret(body.token)) return miss();
  const tokenHash = fingerprint(body.token);
  const now = iso(deps.now());

  const open = await accounts.findInvite(tokenHash, now);
  const profile = open ? await accounts.forAccount(open.accountId).getProfile(open.profileId) : null;
  if (!open || !profile) return miss();

  if (body.action === "peek") return json({ profile: card(profile), expiresAt: open.expiresAt });
  if (body.action !== "join") return error(400, "Unknown action.");

  if ((await devicesFor(accounts, open)).length >= MAX_DEVICES_PER_PROFILE) {
    return error(400, `This profile already has ${MAX_DEVICES_PER_PROFILE} devices. Ask your parent to remove one.`);
  }
  // A device studies as one kid at a time: joining replaces any earlier link here.
  const previous = readCookie(request, KID_COOKIE);
  if (isSecret(previous)) unlinked(await accounts.removeDevice(fingerprint(previous)), "replaced");

  const secret = newSecret();
  const deviceId = deps.newId();
  const linked = await accounts.redeemInvite(tokenHash, now, {
    id: deviceId,
    tokenHash: fingerprint(secret),
    label: deviceLabel(request.headers.get("user-agent")),
  });
  if (!linked) return miss();
  securityEvent("device.linked", { accountId: linked.accountId, profileId: linked.profileId, deviceId });
  return json({ profile: card(profile) }, 201, {
    "set-cookie": cookie(request, KID_COOKIE, secret, DEVICE_DAYS * 24 * 60 * 60),
  });
}

/** DELETE: this device stops being linked (the kid or parent tapped "remove this device"). */
export async function deleteKid(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const secret = readCookie(request, KID_COOKIE);
  if (isSecret(secret) && deps.accounts) unlinked(await deps.accounts.removeDevice(fingerprint(secret)), "kid");
  return json({ ok: true }, 200, { "set-cookie": cookie(request, KID_COOKIE, "", 0) });
}
