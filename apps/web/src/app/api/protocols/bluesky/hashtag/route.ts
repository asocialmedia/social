import { readNetworkPreferences } from "@asm/db";
import {
  defaultNetworkPreferences,
  normalizeHashtag,
  hasHashtag,
} from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { externalNetworkPostAllowed } from "@/lib/posts/network-content-policy";
import { ProtocolGatewayError, protocolRoute } from "@/lib/protocols/gateway";
import { readBlueskyProfileResource } from "@/lib/protocols/service";
import { guestSearchBudget } from "@/lib/search/guest-budget";

export function GET(request: Request) {
  return protocolRoute(request, "search", async (id) => {
    const query = new URL(request.url).searchParams;
    const tag = normalizeHashtag(query.get("tag") ?? "");
    if (!tag || (query.get("cursor")?.length ?? 0) > 4096) {
      throw new ProtocolGatewayError(400, "invalid_query");
    }
    const budget = await guestSearchBudget(request);
    if (budget.response) {
      return budget.response;
    }
    const session = await getSessionFromApi();
    const settings = session?.user
      ? await readNetworkPreferences(session.user.id)
      : null;
    const preferences = settings?.preferences ?? defaultNetworkPreferences();
    const upstream = new URLSearchParams({ tag });
    if (query.get("cursor")) {
      upstream.set("cursor", query.get("cursor") ?? "");
    }
    const result = await readBlueskyProfileResource(
      "hashtag",
      upstream,
      request.signal,
      id,
      preferences.showExplicitContent
    );
    if (!("items" in result)) {
      throw new ProtocolGatewayError(503, "invalid_response");
    }
    return Response.json(
      {
        ...result,
        items: result.items.filter(
          (post) =>
            hasHashtag(post, tag) &&
            externalNetworkPostAllowed(post, preferences)
        ),
      },
      { headers: budget.headers }
    );
  });
}
