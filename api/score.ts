// Vercel Function: /api/score (POST answers as they are given; each batch is counted once)
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { submitScore } from "../server/handlers.js";
import { withErrors } from "../server/route.js";

export const POST = withErrors("/api/score", (request) => submitScore(request));
