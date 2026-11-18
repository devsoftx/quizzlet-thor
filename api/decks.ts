// Vercel Function: /api/decks (the signed-in account's private decks; ?id= for PATCH/DELETE).
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { createDeck, deleteDeck, listDecks, updateDeck } from "../server/library-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/decks", (request) => listDecks(request));
export const POST = withErrors("/api/decks", (request) => createDeck(request));
export const PATCH = withErrors("/api/decks", (request) => updateDeck(request));
export const DELETE = withErrors("/api/decks", (request) => deleteDeck(request));
