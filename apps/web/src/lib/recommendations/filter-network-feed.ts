import { readNetworkPreferences, filterExternalMediaSafety } from "@asm/db";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

import {
  activeNetworkInterests,
  networkPostRecommended,
} from "@/lib/posts/network-content-policy";
import type { PresentedPost } from "@/lib/posts/presentation";
import { isGuestQualityPost } from "@/lib/posts/trending-eligibility";

// Legacy archive and secondary-feed requests enforce the same account policy.
export async function filterNetworkFeed<T extends PresentedPost>(
  posts: T[],
  userId: string
): Promise<T[]> {
  const settings = userId ? await readNetworkPreferences(userId) : null;
  const preferences = settings?.preferences ?? defaultNetworkPreferences();
  const interests = activeNetworkInterests(preferences);
  let scope: NetworkTopicScope | undefined;
  if (userId && (interests.length || preferences.avoidedTopics.length)) {
    const { networkTopicScope } = await import("@asm/db");
    scope = await networkTopicScope(interests, preferences.avoidedTopics);
  }
  const external = posts.flatMap((post) =>
    post.external ? [post.external] : []
  );
  const safeExternal = new Set(
    (preferences.showExplicitContent
      ? external
      : await filterExternalMediaSafety(external)
    ).map((post) => post.id)
  );
  return posts.filter(
    (post) =>
      (!post.external || safeExternal.has(post.external.id)) &&
      networkPostRecommended(post, preferences, scope) &&
      // A guest has no persona to personalise with, so quality is the gate:
      // proven engagement, not the current hot list.
      (Boolean(userId) || isGuestQualityPost(post))
  );
}
