// Vercel Function: /api/me (GET account + profiles, PATCH settings, DELETE account). Requires sign-in.
import { deleteMe, getMe, updateMe } from "../server/account-handlers.js";

export const GET = (request: Request) => getMe(request);
export const PATCH = (request: Request) => updateMe(request);
export const DELETE = (request: Request) => deleteMe(request);
