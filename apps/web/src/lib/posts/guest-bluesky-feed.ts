import "server-only";
import { filterExternalMediaSafety } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  blueskyMediaIsExplicit,
  discoveryLocaleSchema,
  hasRestrictedDiscoveryLabels,
  isExternalTrendingPost,
} from "@asm/protocols/discovery";

import {
  cachedDiscoveryHead,
  discoveryCacheKey,
} from "@/lib/protocols/discovery-cache";

export function guestDiscoveryLocale(
  languageHeader: string | null,
  country: string | null
) {
  const candidate =
    languageHeader?.split(",")[0]?.split(";")[0]?.trim() ?? "en";
  const parsed = discoveryLocaleSchema.safeParse(candidate);
  const locale = parsed.success && parsed.data !== "all" ? parsed.data : "en";
  const region = country?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) && region !== "XX"
    ? `${locale.split("-")[0]}-${region}`
    : locale;
}

function isPublicPost(post: ExternalPost) {
  if (!isExternalTrendingPost(post) || blueskyMediaIsExplicit(post)) {
    return false;
  }
  let current: ExternalPost | undefined = post;
  while (current) {
    if (hasRestrictedDiscoveryLabels(current)) {
      return false;
    }
    current = current.quote;
  }
  return true;
}

function publicSnapshot(post: ExternalPost): ExternalPost {
  return {
    ...post,
    asm: undefined,
    discoveryContext: undefined,
    networkRecommendationToken: undefined,
    quote: post.quote ? publicSnapshot(post.quote) : undefined,
    recommendationSources: undefined,
  };
}

export async function getGuestBlueskyFeed(
  locale: string
): Promise<ExternalPost[]> {
  const signal = AbortSignal.timeout(250);
  try {
    const cached = await abortable(
      cachedDiscoveryHead(discoveryCacheKey("latest", locale, [])),
      signal
    );
    if (!cached) {
      return [];
    }
    const posts = await abortable(
      filterExternalMediaSafety(cached.page.items.filter(isPublicPost)),
      signal
    );
    return posts.map(publicSnapshot);
  } catch {
    // A cold or unavailable network must not hold the native public feed behind it.
    return [];
  }
}
