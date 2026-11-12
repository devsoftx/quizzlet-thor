// Small helpers shared by the API handlers.

export const NAME_MAX = 24;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const error = (status: number, message: string) => json({ error: message }, status);

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Trim and collapse spaces; letters, numbers, spaces, - ' . only. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) return null;
  return name;
}
