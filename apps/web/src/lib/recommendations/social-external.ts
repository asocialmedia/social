import { networkSocialCandidates } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

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
    try {
      items = await readBlueskyPosts(
        social.external.map((entry) => entry.id),
        signal,
        requestId,
        true
      );
    } catch {
      partial = true;
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
