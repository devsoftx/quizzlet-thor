// Vercel Function: /api/files (the signed-in account's private files in Blob storage).
// GET list / ?id= read link; POST ?action=start|sign|confirm; PUT (local dev uploads); DELETE ?id=.
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { deleteFile, getFiles, postFiles, putFile } from "../server/library-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/files", (request) => getFiles(request));
export const POST = withErrors("/api/files", (request) => postFiles(request));
export const PUT = withErrors("/api/files", (request) => putFile(request));
export const DELETE = withErrors("/api/files", (request) => deleteFile(request));
