// Vercel Function: /api/profiles (kid profiles of the signed-in account; ?id= for PATCH/DELETE).
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { createProfile, deleteProfile, listProfiles, updateProfile } from "../server/account-handlers.js";
import { withErrors } from "../server/route.js";

export const GET = withErrors("/api/profiles", (request) => listProfiles(request));
export const POST = withErrors("/api/profiles", (request) => createProfile(request));
export const PATCH = withErrors("/api/profiles", (request) => updateProfile(request));
export const DELETE = withErrors("/api/profiles", (request) => deleteProfile(request));
