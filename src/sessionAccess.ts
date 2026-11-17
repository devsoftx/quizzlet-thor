type AccessResult = { status: "allowed" } | { status: "stale" } | { status: "denied"; error: unknown };

/** Never apply an asynchronous access result to a replacement or expired session. */
export async function checkSessionAccess(
  startingTag: string | undefined,
  currentTag: () => string | undefined,
  check: () => Promise<void>,
): Promise<AccessResult> {
  if (!startingTag || startingTag !== currentTag()) return { status: "stale" };
  try {
    await check();
  } catch (error) {
    return startingTag === currentTag() ? { status: "denied", error } : { status: "stale" };
  }
  return startingTag === currentTag() ? { status: "allowed" } : { status: "stale" };
}
