// Vercel Function: /api/decks (the signed-in account's private decks; ?id= for PATCH/DELETE).
import { createDeck, deleteDeck, listDecks, updateDeck } from "../server/library-handlers.js";

export const GET = (request: Request) => listDecks(request);
export const POST = (request: Request) => createDeck(request);
export const PATCH = (request: Request) => updateDeck(request);
export const DELETE = (request: Request) => deleteDeck(request);
