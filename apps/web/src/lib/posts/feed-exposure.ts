type Surface = "home" | "gusts";
const RETENTION_MS = 2 * 60 * 60_000;
const MAX_EXPOSURES = 600;

// Only IDs stay in this browser session; browsing does not mirror remote posts into the database.
export function rememberFeedExposure(
  viewer: string,
  surface: Surface,
  id: string,
  now = Date.now()
) {
  try {
    const key = `asm:feed-exposure:${viewer}`;
    const entries = readExposures(viewer, now).filter(
      (entry) => entry.id !== id
    );
    sessionStorage.setItem(
      key,
      JSON.stringify(
        [...entries, { at: now, id, surface }].slice(-MAX_EXPOSURES)
      )
    );
  } catch {
    // Storage restrictions never prevent reading the feed.
  }
}

function readExposures(
  viewer: string,
  now: number
): { id: string; surface: Surface; at: number }[] {
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(`asm:feed-exposure:${viewer}`) ?? "[]"
    );
    return Array.isArray(raw)
      ? raw
          .filter(
            (entry): entry is { id: string; surface: Surface; at: number } =>
              Boolean(
                entry &&
                typeof entry.id === "string" &&
                ["home", "gusts"].includes(entry.surface) &&
                Number.isFinite(entry.at) &&
                entry.at > now - RETENTION_MS
              )
          )
          .slice(-MAX_EXPOSURES)
      : [];
  } catch {
    return [];
  }
}

export function otherFeedExposures(
  viewer: string,
  surface: Surface,
  now = Date.now()
): Set<string> {
  return new Set(
    readExposures(viewer, now)
      .filter((entry) => entry.surface !== surface)
      .map((entry) => entry.id)
  );
}
