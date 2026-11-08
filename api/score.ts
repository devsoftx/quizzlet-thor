// Vercel Function: /api/score (POST a finished round)
import { submitScore } from "../server/handlers.js";

export const POST = (request: Request) => submitScore(request);
