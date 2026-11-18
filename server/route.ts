// The wrapper every api/*.ts export goes through: it refuses cross-site
// writes before a handler runs, and turns an unexpected error into a logged,
// generic 500 instead of a platform error page.

import { authorizedParties } from "./auth.js";
import { error, requireSameOrigin } from "./http.js";
import { errorName, securityEvent } from "./log.js";

type Handler = (request: Request) => Promise<Response>;

export function withErrors(route: string, handler: Handler, env: Record<string, string | undefined> = process.env): Handler {
  return async (request) => {
    try {
      const crossSite = requireSameOrigin(request, authorizedParties(env));
      if (crossSite) {
        securityEvent("request.cross_site", { route, method: request.method });
        return crossSite;
      }
      return await handler(request);
    } catch (err) {
      securityEvent("request.error", {
        route,
        method: request.method,
        errorName: errorName(err),
        requestId: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
      });
      return error(500, "Something went wrong.");
    }
  };
}
