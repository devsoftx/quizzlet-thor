// Vercel Function: /api/leaderboard (GET top students)
import { getLeaderboard } from "../server/handlers.js";

export const GET = (request: Request) => getLeaderboard(request);
