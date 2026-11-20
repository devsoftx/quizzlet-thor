// Vercel Function: /api/progress (GET ?profileId=&days=: one kid's answers for the parent's Progress page). Requires sign-in.
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { getProgress } from "../server/progress-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/progress", (request) => getProgress(request));
