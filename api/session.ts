// Vercel Function: /api/session (GET current, POST start, DELETE end)
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { endSession, getSession, startSession } from "../server/handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/session", (request) => getSession(request));
export const POST = withErrors("/api/session", (request) => startSession(request));
export const DELETE = withErrors("/api/session", (request) => endSession(request));
