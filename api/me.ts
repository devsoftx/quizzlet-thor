// Vercel Function: /api/me (GET account + profiles, PATCH settings, DELETE account). Requires sign-in.
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { deleteMe, getMe, updateMe } from "../server/account-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/me", (request) => getMe(request));
export const PATCH = withErrors("/api/me", (request) => updateMe(request));
export const DELETE = withErrors("/api/me", (request) => deleteMe(request));
