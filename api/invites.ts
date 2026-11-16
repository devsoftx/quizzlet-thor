// Vercel Function: /api/invites (a signed-in parent's kid invitation links and linked devices).
// GET list; POST {profileId} new link; DELETE ?profileId= cancel link, ?deviceId= unlink a device.
import { createInvite, deleteLink, listLinks } from "../server/kid-handlers.js";

export const GET = (request: Request) => listLinks(request);
export const POST = (request: Request) => createInvite(request);
export const DELETE = (request: Request) => deleteLink(request);
