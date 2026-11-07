import "server-only";
import { externalUriSchema } from "@asm/protocols/discovery";
import { cacheLife } from "next/cache";
import { cache } from "react";

import { readBlueskyPosts } from "@/lib/protocols/service";

async function readPublicBlueskyPost(uri: string) {
  "use cache";
  cacheLife({ expire: 300, revalidate: 60, stale: 60 });
  // Shared HTML uses the guest policy, even for signed-in visitors.
  // Propagate outages instead of caching them as deleted posts.
  const posts = await readBlueskyPosts(
    [uri],
    undefined,
    "public-post-seo",
    false,
    true,
    false
  );
  const post = posts.find((candidate) => candidate.id === uri);
  if (!post) {
    return null;
  }
  return {
    ...post,
    asm: undefined,
    discoveryContext: undefined,
    networkRecommendationToken: undefined,
    recommendationSources: undefined,
  };
}

export const getPublicBlueskyPost = cache(
  async (rawUri: string | undefined) => {
    const parsed = externalUriSchema.safeParse(rawUri);
    if (!parsed.success) {
      return null;
    }
    try {
      return await readPublicBlueskyPost(parsed.data);
    } catch (error) {
      // Cache only successful public reads; the interactive reader retains its retry and viewer policy.
      console.warn(
        "Public Bluesky preview unavailable",
        error instanceof Error ? error.message : "source unavailable"
      );
      return null;
    }
  }
);
