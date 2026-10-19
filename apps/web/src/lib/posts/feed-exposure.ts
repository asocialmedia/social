export type FeedExposureSurface = "home" | "gusts" | "explore";
type Surface = FeedExposureSurface;
const RETENTION_MS = 24 * 60 * 60_000;
const MAX_EXPOSURES = 600;
const REVISIT_EXCLUSION_MS = 30 * 60_000;
const browsingSession = crypto.randomUUID();
export const FEED_EXPOSURE_EVENT = "asm:feed-exposure";

function exposureStorage() {
  return typeof localStorage === "undefined" ? sessionStorage : localStorage;
}

export function feedExposureSnapshot(
  viewer: string,
  surface?: Surface
): string {
  try {
    const raw =
      exposureStorage().getItem(`asm:feed-exposure:${viewer}`) ?? "[]";
    return surface
      ? JSON.stringify(
          readExposures(viewer, Date.now(), raw)
            .filter(
              (entry) =>
                entry.surface !== surface ||
                (Boolean(entry.session) && entry.session !== browsingSession) ||
                Date.now() - entry.at >= REVISIT_EXCLUSION_MS
            )
            .map((entry) => entry.id)
        )
      : raw;
  } catch {
    return "[]";
  }
}

// Persist only bounded IDs, so returning tomorrow does not replay the other sections' viewed posts.
export function rememberFeedExposure(
  viewer: string,
  surface: Surface,
  id: string,
  now = Date.now()
) {
  try {
    const key = `asm:feed-exposure:${viewer}`;
    const previous = readExposures(viewer, now);
    if (
      previous.some(
        (entry) =>
          entry.id === id &&
          entry.surface === surface &&
          now - entry.at < 60_000
      )
    ) {
      return;
    }
    const entries = previous.filter((entry) => entry.id !== id);
    exposureStorage().setItem(
      key,
      JSON.stringify(
        [...entries, { at: now, id, session: browsingSession, surface }].slice(
          -MAX_EXPOSURES
        )
      )
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(FEED_EXPOSURE_EVENT));
    }
  } catch {
    // Storage restrictions never prevent reading the feed.
  }
}

function readExposures(
  viewer: string,
  now: number,
  snapshot = feedExposureSnapshot(viewer)
): { id: string; surface: Surface; at: number; session?: string }[] {
  try {
    const raw: unknown = JSON.parse(snapshot);
    return Array.isArray(raw)
      ? raw
          .filter(
            (
              entry
            ): entry is {
              id: string;
              surface: Surface;
              at: number;
              session?: string;
            } =>
              Boolean(
                entry &&
                typeof entry.id === "string" &&
                ["home", "gusts", "explore"].includes(entry.surface) &&
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
  now = Date.now(),
  snapshot?: string
): Set<string> {
  return new Set(
    readExposures(viewer, now, snapshot)
      .filter(
        (entry) =>
          entry.surface !== surface ||
          (Boolean(entry.session) && entry.session !== browsingSession) ||
          now - entry.at >= REVISIT_EXCLUSION_MS
      )
      .map((entry) => entry.id)
  );
}
