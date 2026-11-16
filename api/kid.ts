// Vercel Function: /api/kid (a kid's own device, linked through an invitation; no account).
// GET who this device studies as; POST {action: peek|join, token}; DELETE unlink this device.
// Access comes from the one-time invitation token or the device's HttpOnly cookie.
import { deleteKid, getKid, postKid } from "../server/kid-handlers.js";

export const GET = (request: Request) => getKid(request);
export const POST = (request: Request) => postKid(request);
export const DELETE = (request: Request) => deleteKid(request);
