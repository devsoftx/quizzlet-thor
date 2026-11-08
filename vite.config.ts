import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

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

    const response = (await handler(request)) as Response;
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
  plugins: [react(), vercelFunctionsDev()],
  server: { port: 5173 },
});
