import { consumeRateLimit, getClientIpFromRequest } from "@asm/db";
import { abortable } from "@asm/protocols/discovery";

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
  const refresh = query.get("refresh") === "1";
  const global = Promise.allSettled([getTrendingFeed(refresh, true)]);
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
  const [[globalResult], [personalized]] = await Promise.all([
    global,
    Promise.allSettled([
      focused
        ? (async () => {
            const cached = await cachedDiscoveryHead(
              discoveryCacheKey("personalized", locale, topics, explicit)
            );
            const signal = AbortSignal.any([
              request.signal,
              AbortSignal.timeout(750),
            ]);
            const page =
              cached?.page ??
              (await abortable(
                readBlueskyDiscovery(
                  "personalized",
                  undefined,
                  signal,
                  crypto.randomUUID(),
                  locale,
                  topics,
                  explicit
                ),
                signal
              ));
            return {
              items: interestTrendingTopics(page.items, {
                ...context,
                selected: { ...context.selected, interests },
              }),
              partial: page.partial,
            };
          })()
        : Promise.resolve({ items: [], partial: false }),
    ]),
  ]);
  if (
    globalResult.status === "rejected" &&
    (!focused || personalized.status === "rejected")
  ) {
    return Response.json(
      { error: "Trending is temporarily unavailable" },
      { headers, status: 503 }
    );
  }
  const data =
    globalResult.status === "fulfilled"
      ? globalResult.value
      : {
          items: [],
          topAura: [],
          unavailable: ["hashtags", "mentions", "aura"] as const,
        };
  let items = filterTrendingForInterests(
    data.items,
    interests,
    context.preferences.avoidedTopics,
    context.topicScope
  );
  const related =
    personalized.status === "fulfilled" ? personalized.value.items : [];
  if (!related.length && !items.length && !context.selected.interests.length) {
    items = filterTrendingForInterests(
      data.items,
      [],
      context.preferences.avoidedTopics,
      context.topicScope
    );
  }
  const networkTopics = [
    ...new Map(
      [
        ...items.filter((item) => item.type === "bluesky_topic"),
        ...related,
      ].map((item) => [item.topic.toLowerCase(), item])
    ).values(),
  ];
  const hasBluesky = networkTopics.length > 0;
  return Response.json(
    {
      items: weaveTrendingItems(
        items.filter((item) => item.type !== "bluesky_topic"),
        networkTopics,
        30
      ),
      topAura: data.topAura,
      unavailable: [
        ...new Set([
          ...data.unavailable.filter(
            (source) => source !== "bluesky" || !hasBluesky
          ),
          ...(focused &&
          (personalized.status === "rejected" || personalized.value.partial)
            ? ["bluesky"]
            : []),
        ]),
      ],
    },
    { headers }
  );
}
