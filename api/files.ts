// Vercel Function: /api/files (the signed-in account's private files in Blob storage).
// GET list / ?id= read link; POST ?action=start|sign|confirm; PUT (local dev uploads); DELETE ?id=.
import { deleteFile, getFiles, postFiles, putFile } from "../server/library-handlers.js";

export const GET = (request: Request) => getFiles(request);
export const POST = (request: Request) => postFiles(request);
export const PUT = (request: Request) => putFile(request);
export const DELETE = (request: Request) => deleteFile(request);
