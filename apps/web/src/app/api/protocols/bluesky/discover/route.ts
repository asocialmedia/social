// Watch registration is best-effort after the viewer's page has completed.
// oxlint-disable promise/prefer-await-to-then
import { externalPostStates, getRecommendationProfile, redis } from "@asm/db";
import {
  discoveryModeSchema,
  discoveryLocaleSchema,
  filterExternalRecommendations,
  DISCOVERY_WATCH_CHANNEL,
} from "@asm/protocols/discovery";
import { after } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
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

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async (id) => {
    const query = new URL(request.url).searchParams;
    const mode = discoveryModeSchema.safeParse(query.get("mode") ?? "latest");
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
    const profile =
      session?.user.id && mode.data === "personalized"
        ? await getRecommendationProfile(session.user.id).catch(() => null)
        : null;
    void redis
      .publish(
        DISCOVERY_WATCH_CHANNEL,
        JSON.stringify({
          locale: locale.data,
          mode: mode.data,
          topics: profile ? discoveryTopics(profile) : [],
        })
      )
      .catch(() => {
        // Foreground reads remain usable if watch registration is unavailable.
      });
    const topics = profile ? discoveryTopics(profile) : [];
    const cacheKey = discoveryCacheKey(mode.data, locale.data, topics);
    const cached = cursor ? null : await cachedDiscoveryHead(cacheKey);
    const read = async (signal: AbortSignal) => {
      const page = await readBlueskyDiscovery(
        mode.data,
        cursor,
        signal,
        id,
        locale.data,
        topics
      );
      if (!cursor) {
        await saveDiscoveryHead(cacheKey, page).catch(() => {
          /* empty */
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
    const filtered = filterExternalRecommendations(page.items, excluded);
    const items =
      mode.data === "personalized"
        ? rankExternalForViewer(
            filtered,
            profile ?? { authorWeights: {}, tagWeights: {} },
            { locale: locale.data }
          )
        : filtered;
    const states = await externalPostStates(
      items.map((post) => post.id),
      session?.user.id
    );
    return Response.json({
      ...page,
      items: items.map((post) => ({ ...post, asm: states.get(post.id) })),
    });
  });
}
