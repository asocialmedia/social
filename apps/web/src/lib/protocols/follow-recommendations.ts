import { externalFollowAuthors } from "@asm/db";
import { after } from "next/server";

import { readFollowingFeed } from "./following-feed";

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
      includeExplicit,
      true
    );
    if (page.partial && !page.items.length) {
      after(async () => {
        try {
          await readFollowingFeed(
            userId,
            undefined,
            AbortSignal.timeout(15_000),
            requestId,
            policy,
            false,
            includeExplicit
          );
        } catch {
          // Following stays usable independently if an optional Home candidate source is down.
        }
      });
    }
    return { followed, items: page.items, partial: page.partial };
  } catch {
    return { followed, items: [], partial: true };
  }
}
