import { externalFollowAuthors } from "@asm/db";

import { readFollowingFeed } from "./following-feed";
import { readBlueskyPosts } from "./service";

export async function followedExternalRecommendations(
  userId: string,
  includeCandidates: boolean,
  signal: AbortSignal,
  requestId: string,
  policy: string,
  includeExplicit: boolean
) {
  const authors = await externalFollowAuthors(userId);
  const followed = new Set(
    authors
      .filter((author) => author.status === "active")
      .map((author) => author.did)
  );
  if (!includeCandidates || !followed.size) {
    return { followed, items: [], partial: false };
  }
  try {
    const page = await readFollowingFeed(
      userId,
      undefined,
      signal,
      requestId,
      policy,
      false,
      includeExplicit
    );
    const items = page.items.length
      ? await readBlueskyPosts(
          page.items.map((post) => post.id),
          signal,
          requestId,
          true
        )
      : [];
    return { followed, items, partial: page.partial };
  } catch {
    return { followed, items: [], partial: true };
  }
}
