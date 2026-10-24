import { consumeRateLimit, getClientIpFromRequest } from "@asm/db";

import { getTrendingFeed } from "@/components/home/sidebars/right/trending-actions";
import {
  filterTrendingForInterests,
  weaveTrendingItems,
} from "@/components/home/sidebars/right/trending-utils";
import { getSessionFromApi } from "@/lib/auth/session";
import {
  cachedDiscoveryHead,
  discoveryCacheKey,
} from "@/lib/protocols/discovery-cache";
import { discoveryTopics } from "@/lib/protocols/recommendations";
import { readBlueskyDiscovery } from "@/lib/protocols/service";
import { interestTrendingTopics } from "@/lib/recommendations/interest-trending";
import {
  networkFeedContext,
  networkRegionalLocale,
} from "@/lib/recommendations/network-context";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store", vary: "Cookie" };
  const query = new URL(request.url).searchParams;
  const session = await getSessionFromApi();
  const rate = await consumeRateLimit({
    bucket: "sidebar-trending",
    identifier: session?.user.id ?? `guest:${getClientIpFromRequest(request)}`,
    limit: session ? 30 : 10,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Try again shortly" },
      {
        headers: { ...headers, "retry-after": String(rate.retryAfterSeconds) },
        status: 429,
      }
    );
  }
  const context = await networkFeedContext(
    session?.user.id,
    query.get("profile") ?? undefined
  );
  const interests = context.selected.interests.length
    ? context.selected.interests
    : discoveryTopics(context.profile, [], context.topicScope);
  const topics = discoveryTopics(
    context.profile,
    interests,
    context.topicScope
  );
  const focused = interests.length > 0;
  const locale = networkRegionalLocale(context, "en");
  const explicit = Boolean(session && context.preferences.showExplicitContent);
  const [global, personalized] = await Promise.allSettled([
    getTrendingFeed(query.get("refresh") === "1", !focused),
    focused
      ? (async () => {
          const cached = await cachedDiscoveryHead(
            discoveryCacheKey("personalized", locale, topics, explicit)
          );
          const page =
            cached?.page ??
            (await readBlueskyDiscovery(
              "personalized",
              undefined,
              AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
              crypto.randomUUID(),
              locale,
              topics,
              explicit
            ));
          return interestTrendingTopics(page.items, {
            ...context,
            selected: { ...context.selected, interests },
          });
        })()
      : Promise.resolve([]),
  ]);
  if (global.status === "rejected" && personalized.status === "rejected") {
    return Response.json(
      { error: "Trending is temporarily unavailable" },
      { headers, status: 503 }
    );
  }
  const data =
    global.status === "fulfilled"
      ? global.value
      : {
          items: [],
          topAura: [],
          unavailable: ["hashtags", "mentions", "aura"] as const,
        };
  const items = filterTrendingForInterests(
    data.items,
    interests,
    context.preferences.avoidedTopics,
    context.topicScope
  );
  return Response.json(
    {
      items: weaveTrendingItems(
        items.filter((item) => item.type !== "bluesky_topic"),
        [
          ...(personalized.status === "fulfilled" ? personalized.value : []),
          ...items.filter((item) => item.type === "bluesky_topic"),
        ],
        30
      ),
      topAura: data.topAura,
      unavailable: [
        ...data.unavailable,
        ...(personalized.status === "rejected" ? ["bluesky"] : []),
      ],
    },
    { headers }
  );
}
