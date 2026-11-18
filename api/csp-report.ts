// Vercel Function: /api/csp-report (browsers post Content-Security-Policy violation reports here).
// Every export goes through withErrors: cross-site writes are refused and unexpected errors are logged.
import { cspReport } from "../server/csp-handlers.js";
import { withErrors } from "../server/route.js";

export const POST = withErrors("/api/csp-report", (request) => cspReport(request));
