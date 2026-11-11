import "server-only";
import { externalUriSchema } from "@asm/protocols/discovery";
import { cacheLife, io } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { readBlueskyPosts } from "@/lib/protocols/service";

async function readPublicBlueskyPost(uri: string) {
  "use cache";
  // Shared HTML uses the guest policy, even for signed-in visitors.
  let posts: Awaited<ReturnType<typeof readBlueskyPosts>>;
  try {
    posts = await readBlueskyPosts(
      [uri],
      undefined,
      "public-post-seo",
      false,
      true,
      false
    );
  } catch (error) {
    unstable_rethrow(error);
    // Expected outages must not cross the cache boundary as RSC render errors.
    // Retry promptly instead of caching an unavailable preview as a missing post.
    cacheLife({ expire: 2, revalidate: 0, stale: 0 });
    return {
      post: null,
      unavailable:
        error instanceof Error ? error.message : "source unavailable",
    };
  }
  cacheLife({ expire: 300, revalidate: 60, stale: 60 });
  const post = posts.find((candidate) => candidate.id === uri);
  if (!post) {
    return { post: null, unavailable: null };
  }
  return {
    post: {
      ...post,
      asm: undefined,
      discoveryContext: undefined,
      networkRecommendationToken: undefined,
      recommendationSources: undefined,
    },
    unavailable: null,
  };
}

export const getPublicBlueskyPost = cache(
  async (rawUri: string | undefined) => {
    const parsed = externalUriSchema.safeParse(rawUri);
    if (!parsed.success) {
      return null;
    }
    try {
      const result = await readPublicBlueskyPost(parsed.data);
      if (result.unavailable !== null) {
        await io();
        console.warn("Public Bluesky preview unavailable", result.unavailable);
      }
      return result.post;
    } catch (error) {
      unstable_rethrow(error);
      // Logging reads the clock through Pino; defer it until this is outside prerendering.
      await io();
      // Unexpected cache failures still leave the interactive reader available.
      console.warn(
        "Public Bluesky preview unavailable",
        error instanceof Error ? error.message : "source unavailable"
      );
      return null;
    }
  }
);
