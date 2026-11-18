// Vercel Function: /api/invites (a signed-in parent's kid invitation links and linked devices).
// GET list; POST {profileId} new link; DELETE ?profileId= cancel link, ?deviceId= unlink a device.
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { createInvite, deleteLink, listLinks } from "../server/kid-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/invites", (request) => listLinks(request));
export const POST = withErrors("/api/invites", (request) => createInvite(request));
export const DELETE = withErrors("/api/invites", (request) => deleteLink(request));
