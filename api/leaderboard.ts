// Vercel Function: /api/leaderboard (GET top students)
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { getLeaderboard } from "../server/handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/leaderboard", (request) => getLeaderboard(request));
