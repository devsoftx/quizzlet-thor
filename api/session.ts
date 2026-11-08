// Vercel Function: /api/session (GET current, POST start, DELETE end)
import { endSession, getSession, startSession } from "../server/handlers.js";

export const GET = (request: Request) => getSession(request);
export const POST = (request: Request) => startSession(request);
export const DELETE = (request: Request) => endSession(request);
