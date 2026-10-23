import { networkSocialCandidates } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { after } from "next/server";

import { readBlueskyPosts } from "@/lib/protocols/service";

export async function socialExternalRecommendations(
  viewerId: string,
  includeCandidates: boolean,
  signal: AbortSignal,
  requestId: string
) {
  const social = await networkSocialCandidates(viewerId);
  const byId = new Map(social.external.map((entry) => [entry.id, entry]));
  let items: ExternalPost[] = [];
  let partial = false;
  if (includeCandidates && social.external.length) {
    const ids = social.external
      .toSorted((first, second) => second.weight - first.weight)
      .slice(0, 25)
      .map((entry) => entry.id);
    try {
      items = await readBlueskyPosts(
        ids,
        AbortSignal.any([signal, AbortSignal.timeout(1000)]),
        requestId,
        true
      );
    } catch {
      partial = true;
      if (!signal.aborted) {
        after(async () => {
          try {
            await readBlueskyPosts(
              ids,
              AbortSignal.timeout(15_000),
              requestId,
              true
            );
          } catch {
            // Optional graph hydration must not delay healthy discovery content.
          }
        });
      }
    }
  }
  return {
    annotate: (post: ExternalPost): ExternalPost => ({
      ...post,
      recommendationSources: byId.get(post.id)?.sources,
    }),
    items,
    partial,
    weights: new Map(social.external.map((entry) => [entry.id, entry.weight])),
  };
}
