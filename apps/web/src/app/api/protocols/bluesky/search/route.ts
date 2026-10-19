import { readNetworkPreferences } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  blueskyMediaIsExplicit,
  isExplicitTagOrTopic,
} from "@/lib/protocols/content-labels";
import { ProtocolGatewayError, protocolRoute } from "@/lib/protocols/gateway";
import { readBlueskySearch } from "@/lib/protocols/service";
import { guestSearchBudget } from "@/lib/search/guest-budget";

export function GET(request: Request) {
  return protocolRoute(request, "search", async (id) => {
    const parsed = z
      .object({
        kind: z.enum(["all", "user", "post"]).default("all"),
        q: z.string().trim().min(2).max(80),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_query");
    }
    const budget = await guestSearchBudget(request);
    if (budget.response) {
      return budget.response;
    }

    const session = await getSessionFromApi();
    const settings = session?.user?.id
      ? await readNetworkPreferences(session.user.id)
      : null;
    const allowExplicit = Boolean(settings?.preferences.showExplicitContent);

    const raw = await readBlueskySearch(
      parsed.data.q,
      request.signal,
      id,
      parsed.data.kind
    );

    if (!allowExplicit) {
      raw.posts = raw.posts.filter((post) => !blueskyMediaIsExplicit(post));
      raw.profiles = raw.profiles.filter(
        (profile) =>
          !profile.labels.some((l) => isExplicitTagOrTopic(l)) &&
          !isExplicitTagOrTopic(profile.handle) &&
          !isExplicitTagOrTopic(profile.displayName) &&
          (!profile.description || !isExplicitTagOrTopic(profile.description))
      );
    }

    return Response.json(raw, { headers: budget.headers });
  });
}
