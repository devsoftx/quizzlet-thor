// Vercel Function: /api/cron (the daily cleanup run by Vercel Cron; needs the CRON_SECRET bearer token).
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { runCleanup } from "../server/cron-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/cron", (request) => runCleanup(request));
