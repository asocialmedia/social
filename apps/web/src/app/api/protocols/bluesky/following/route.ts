import { externalPostStates } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { externalNetworkPostAllowed } from "@/lib/posts/network-content-policy";
import { readExternalFeedback } from "@/lib/protocols/feedback";
import { readFollowingFeed } from "@/lib/protocols/following-feed";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolRoute,
} from "@/lib/protocols/gateway";
import { networkFeedContext } from "@/lib/recommendations/network-context";

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async (id) => {
    const session = await getSessionFromApi();
    if (!session?.user.id) {
      throw new ProtocolGatewayError(401, "authentication_required");
    }
    await consumeProtocolBudget(session.user.id, "read", true);
    const network = await networkFeedContext(session.user.id);
    const page = await readFollowingFeed(
      session.user.id,
      new URL(request.url).searchParams.get("cursor") ?? undefined,
      request.signal,
      id,
      String(network.revision),
      new URL(request.url).searchParams.get("refresh") === "1",
      network.preferences.showExplicitContent
    );
    const excluded = await readExternalFeedback(session.user.id);
    const items = page.items.filter(
      (post) =>
        !excluded.has(`post:${post.id}`) &&
        !excluded.has(`author:${post.author.id}`) &&
        externalNetworkPostAllowed(
          post,
          network.preferences,
          network.topicScope
        )
    );
    const states = await externalPostStates(
      items.map((post) => post.id),
      session.user.id
    );
    return Response.json({
      ...page,
      items: items.map((post) => ({ ...post, asm: states.get(post.id) })),
    });
  });
}
