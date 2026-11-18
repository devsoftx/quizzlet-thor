import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Connect, type Plugin, type ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

/**
 * Sends the response headers from vercel.json (the security headers) locally
 * too, so `npm run dev`, `npm run preview` and the end-to-end tests see what
 * production sends. In dev only, scripts may also be inline: Vite's React
 * refresh needs that, and the production build has no inline script.
 */
function vercelHeaders(): Plugin {
  const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as { headers?: HeaderRule[] };
  const rules = config.headers ?? [];
  const compiled = rules.map((rule) => ({ test: new RegExp(`^${rule.source}$`), headers: rule.headers }));

  const middleware = (dev: boolean): Connect.NextHandleFunction => (req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    for (const rule of compiled) {
      if (!rule.test.test(pathname)) continue;
      for (const { key, value } of rule.headers) {
        const reportOnly = key.toLowerCase() === "content-security-policy-report-only";
        res.setHeader(key, dev && reportOnly ? value.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : value);
      }
    }
    next();
  };

  return {
    name: "vercel-headers",
    configureServer(server) {
      server.middlewares.use(middleware(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(false));
    },
  };
}

/**
 * Serves the Vercel Functions in /api during `npm run dev`, so the app works
 * locally without `vercel dev`. Each /api/<name>.ts file exports GET/POST/…
 * handlers that take a web Request and return a Response, exactly as on Vercel.
 * Locally they use an in-memory store (see server/store.ts).
 */
function vercelFunctionsDev(): Plugin {
  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    if (!/^[a-z0-9-]+$/.test(route)) return false;

    let mod: Record<string, unknown>;
    try {
      mod = await server.ssrLoadModule(`/api/${route}.ts`);
    } catch {
      return false; // no such function
    }
    const method = req.method ?? "GET";
    const handler = mod[method];
    if (typeof handler !== "function") {
      res.statusCode = 405;
      res.end();
      return true;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const hasBody = method !== "GET" && method !== "HEAD";
    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? new Uint8Array(await readBody(req)) : undefined,
    });

    const response = await (handler as (request: Request) => Response | Promise<Response>)(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
    return true;
  }

  return {
    name: "vercel-functions-dev",
    configureServer(server) {
      // Server code reads process.env, which Vite doesn't fill from .env files.
      // Copy them in (without overriding real env vars), and turn on the local
      // sign-in stand-in when no Clerk keys are present.
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
      if (!process.env.CLERK_SECRET_KEY) process.env.QUIZZLET_DEV_AUTH ??= "1";

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        handle(server, req, res)
          .then((handled) => {
            if (!handled) {
              res.statusCode = 404;
              res.end("Not found");
            }
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelHeaders(), vercelFunctionsDev()],
  // Clerk's Vercel integration names the (public) key NEXT_PUBLIC_…; expose
  // just that one to the browser alongside the usual VITE_ variables.
  envPrefix: ["VITE_", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
  server: { port: 5173 },
  test: {
    // The server writes security events as JSON lines on console.info; tests
    // that check them capture the log themselves (server/test-support.ts).
    onConsoleLog: (line) => !line.startsWith('{"') || !line.includes('"kind":"security"'),
  },
});
