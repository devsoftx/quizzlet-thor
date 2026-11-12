// Vercel Function: /api/profiles (kid profiles of the signed-in account; ?id= for PATCH/DELETE).
import { createProfile, deleteProfile, listProfiles, updateProfile } from "../server/account-handlers.js";

export const GET = (request: Request) => listProfiles(request);
export const POST = (request: Request) => createProfile(request);
export const PATCH = (request: Request) => updateProfile(request);
export const DELETE = (request: Request) => deleteProfile(request);
