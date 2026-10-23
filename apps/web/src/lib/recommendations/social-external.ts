import { networkSocialCandidates } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { abortable } from "@asm/protocols/discovery";
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
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(1000)]);
      items = await abortable(
        readBlueskyPosts(ids, deadline, requestId, true),
        deadline
      );
    } catch {
      partial = true;
      if (!signal.aborted) {
        after(async () => {
          try {
            const deadline = AbortSignal.timeout(15_000);
            await abortable(
              readBlueskyPosts(ids, deadline, requestId, true),
              deadline
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
