import { normalizePostsData } from "./feed-types";

export function parseRelatedFeedPage(payload: unknown) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("posts" in payload) ||
    !Array.isArray(payload.posts)
  ) {
    throw new Error("Couldn't load related posts.");
  }
  return {
    cursor:
      "nextCursor" in payload && typeof payload.nextCursor === "string"
        ? payload.nextCursor
        : null,
    items: normalizePostsData(payload.posts),
  };
}
