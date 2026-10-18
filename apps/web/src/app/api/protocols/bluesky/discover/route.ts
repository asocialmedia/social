// Watch registration is best-effort after the viewer's page has completed.
// oxlint-disable promise/prefer-await-to-then
import {
  externalPostStates,
  networkContentTopics,
  networkLanguageMatches,
  recordSharedTopicRelations,
  redis,
} from "@asm/db";
import { externalPostTopics } from "@asm/protocols/contracts";
import {
  matchesAvoidedTopic,
  discoveryContentSchema,
  discoveryModeSchema,
  discoveryLocaleSchema,
  filterExternalRecommendations,
  DISCOVERY_WATCH_CHANNEL,
} from "@asm/protocols/discovery";
import { after } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { externalNetworkPostRecommended } from "@/lib/posts/network-content-policy";
import { blueskyMediaIsExplicit } from "@/lib/protocols/content-labels";
import {
  cachedDiscoveryHead,
  discoveryCacheKey,
  saveDiscoveryHead,
} from "@/lib/protocols/discovery-cache";
import { readExternalFeedback } from "@/lib/protocols/feedback";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolRoute,
} from "@/lib/protocols/gateway";
import {
  discoveryTopics,
  rankExternalForViewer,
} from "@/lib/protocols/recommendations";
import { readBlueskyDiscovery } from "@/lib/protocols/service";
import {
  networkFeedContext,
  networkRegionalLocale,
} from "@/lib/recommendations/network-context";
import { signNetworkObservation } from "@/lib/recommendations/network-observation";
import { socialExternalRecommendations } from "@/lib/recommendations/social-external";

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async (id) => {
    const query = new URL(request.url).searchParams;
    const mode = discoveryModeSchema.safeParse(query.get("mode") ?? "latest");
    const content = discoveryContentSchema.safeParse(
      query.get("content") ?? "all"
    );
    if (!content.success) {
      throw new ProtocolGatewayError(400, "invalid_content");
    }
    const cursor = query.get("cursor") ?? undefined;
    const locale = discoveryLocaleSchema.safeParse(query.get("locale") ?? "en");
    if (!locale.success) {
      throw new ProtocolGatewayError(400, "invalid_locale");
    }
    if (!mode.success || (cursor && !z.uuid().safeParse(cursor).success)) {
      throw new ProtocolGatewayError(400, "invalid_query");
    }
    const session = await getSessionFromApi();
    if (session?.user.id) {
      await consumeProtocolBudget(session.user.id, "read", true);
    }
    const network = await networkFeedContext(
      session?.user.id,
      query.get("profile") ?? undefined
    );
    const { profile } = network;
    const includeExplicit = Boolean(
      session?.user.id && network.preferences.showExplicitContent
    );
    const topics = discoveryTopics(
      profile,
      network.selected.interests,
      network.topicScope
    ).filter(
      (topic) =>
        !matchesAvoidedTopic(topic, [topic], network.preferences.avoidedTopics)
    );
    void redis
      .publish(
        DISCOVERY_WATCH_CHANNEL,
        JSON.stringify({
          content: content.data,
          locale: locale.data,
          mode: mode.data,
          topics,
        })
      )
      .catch(() => {
        // Foreground reads remain usable if watch registration is unavailable.
      });
    const cacheKey = discoveryCacheKey(
      mode.data,
      locale.data,
      topics,
      includeExplicit,
      content.data
    );
    const cached = cursor ? null : await cachedDiscoveryHead(cacheKey);
    const read = async (signal: AbortSignal) => {
      const page = await readBlueskyDiscovery(
        mode.data,
        cursor,
        signal,
        id,
        locale.data,
        topics,
        includeExplicit,
        content.data
      );
      if (!cursor) {
        await saveDiscoveryHead(cacheKey, page).catch(() => {
          // A failed shared cache write does not discard a successful live read.
        });
      }
      return page;
    };
    if (cached && Date.now() - cached.at > 20_000) {
      after(async () => {
        const lockKey = `${cacheKey}:refresh`;
        const owner = crypto.randomUUID();
        if ((await redis.set(lockKey, owner, "EX", 20, "NX")) !== "OK") {
          return;
        }
        try {
          await read(AbortSignal.timeout(15_000));
        } catch {
          // Keep the usable head through a temporary upstream outage.
        } finally {
          await redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
            1,
            lockKey,
            owner
          );
        }
      });
    }
    const [page, excluded] = await Promise.all([
      cached ? Promise.resolve(cached.page) : read(request.signal),
      session?.user.id
        ? readExternalFeedback(session.user.id)
        : Promise.resolve(new Set<string>()),
    ]);
    const social = session?.user.id
      ? await socialExternalRecommendations(
          session.user.id,
          !cursor,
          request.signal,
          id
        )
      : null;
    const candidates = [
      ...new Map(
        [...page.items, ...(social?.items ?? [])].map((post) => [post.id, post])
      ).values(),
    ];
    const metadata = new Map(
      candidates.map((post) => [
        post.id,
        networkContentTopics(
          `${post.text} ${post.externalLink?.title ?? ""} ${post.media.map((media) => media.alt).join(" ")}`,
          externalPostTopics(post),
          post.languages
        ),
      ])
    );
    const filtered = filterExternalRecommendations(candidates, excluded).filter(
      (post) =>
        (content.data !== "video" ||
          post.media.some((media) => media.type === "video")) &&
        (includeExplicit ? true : !blueskyMediaIsExplicit(post)) &&
        externalNetworkPostRecommended(
          post,
          network.preferences,
          network.selected.interests,
          network.topicScope
        ) &&
        networkLanguageMatches(
          post.text,
          post.languages,
          network.preferences.contentLanguages ?? [network.preferences.language]
        ) &&
        Date.parse(post.createdAt) <= Date.now() + 60_000
    );
    const items =
      mode.data === "latest"
        ? filtered.toSorted(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
          )
        : rankExternalForViewer(filtered, profile, {
            interests: network.selected.interests,
            locale: networkRegionalLocale(network, locale.data),
            mode: mode.data,
            socialProof: social?.weights,
            topicScope: network.topicScope,
            topics: metadata,
          });
    after(async () => {
      await Promise.all(
        items
          .filter((post) => !blueskyMediaIsExplicit(post))
          .map((post) =>
            recordSharedTopicRelations(
              metadata.get(post.id) ?? [],
              `${post.source}:${post.id}`
            ).catch(() => {
              // Shared topic learning is best effort.
            })
          )
      );
    });
    const states = await externalPostStates(
      items.map((post) => post.id),
      session?.user.id
    );
    return Response.json({
      ...page,
      items: await Promise.all(
        items.slice(0, 50).map(async (post) => ({
          ...(social ? social.annotate(post) : post),
          asm: states.get(post.id),
          ...(session?.user.id
            ? {
                networkRecommendationToken: await signNetworkObservation(
                  session.user.id,
                  {
                    authorId: post.author.id,
                    hasImage: post.media.some(
                      (media) => media.type === "image"
                    ),
                    hasVideo: post.media.some(
                      (media) => media.type === "video"
                    ),
                    postId: post.id,
                    profileId: network.selected.id,
                    publicContent: !blueskyMediaIsExplicit(post),
                    revision: network.revision,
                    source: post.source,
                    topics: metadata.get(post.id) ?? [],
                  }
                ),
              }
            : {}),
        }))
      ),
      partial: page.partial || Boolean(social?.partial),
    });
  });
}
