import "server-only";
import { filterExternalMediaSafety } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  blueskyMediaIsExplicit,
  discoveryLocaleSchema,
  hasRestrictedDiscoveryLabels,
} from "@asm/protocols/discovery";

import { readBlueskyDiscovery } from "@/lib/protocols/service";

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
  if (blueskyMediaIsExplicit(post)) {
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
  const signal = AbortSignal.timeout(800);
  try {
    const page = await abortable(
      readBlueskyDiscovery(
        "latest",
        undefined,
        signal,
        undefined,
        locale,
        [],
        false,
        "all"
      ),
      signal
    );
    const posts = await abortable(
      filterExternalMediaSafety(page.items.filter(isPublicPost)),
      signal
    );
    return posts.map(publicSnapshot);
  } catch {
    // A cold or unavailable network must not hold the native public feed behind it.
    return [];
  }
}
