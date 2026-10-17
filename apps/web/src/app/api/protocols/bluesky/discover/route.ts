import { externalPostStates, getRecommendationProfile } from "@asm/db";
import {
  discoveryModeSchema,
  discoveryLocaleSchema,
  filterExternalRecommendations,
} from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
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
    const [page, excluded] = await Promise.all([
      readBlueskyDiscovery(
        mode.data,
        cursor,
        request.signal,
        id,
        locale.data,
        profile ? discoveryTopics(profile) : []
      ),
      session?.user.id
        ? readExternalFeedback(session.user.id)
        : Promise.resolve(new Set<string>()),
    ]);
    const filtered = filterExternalRecommendations(page.items, excluded);
    const items = profile ? rankExternalForViewer(filtered, profile) : filtered;
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
