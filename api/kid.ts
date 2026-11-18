// Vercel Function: /api/kid (a kid's own device, linked through an invitation; no account).
// GET who this device studies as; POST {action: peek|join, token}; DELETE unlink this device.
// Access comes from the one-time invitation token or the device's HttpOnly cookie.
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { deleteKid, getKid, postKid } from "../server/kid-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/kid", (request) => getKid(request));
export const POST = withErrors("/api/kid", (request) => postKid(request));
export const DELETE = withErrors("/api/kid", (request) => deleteKid(request));
