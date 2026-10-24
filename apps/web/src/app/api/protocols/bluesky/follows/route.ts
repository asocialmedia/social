import {
  externalFollowAuthors,
  externalFollowState,
  setExternalFollow,
  ExternalFollowError,
  redis,
  networkContentTopics,
  readNetworkPreferences,
  recordNetworkSignal,
  removeNetworkSignal,
} from "@asm/db";
import { FEED_EVENTS_CHANNEL } from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolJsonBody,
  protocolRoute,
} from "@/lib/protocols/gateway";
import {
  readBlueskyProfileResource,
  verifyBlueskyFollowTarget,
} from "@/lib/protocols/service";
import { invalidateDiscoverySuggestions } from "@/lib/recommendations/suggestion-version";

const did = z
  .string()
  .max(2048)
  .regex(/^did:(?:plc|web):[A-Za-z0-9._:%-]+$/);
const mutation = z.object({ active: z.boolean(), actor: did });

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async () => {
    const session = await getSessionFromApi();
    const actor = new URL(request.url).searchParams.get("actor");
    if (actor) {
      const parsed = did.safeParse(actor);
      if (!parsed.success) {
        throw new ProtocolGatewayError(400, "invalid_actor");
      }
      return Response.json({
        following: session?.user.id
          ? await externalFollowState(session.user.id, parsed.data)
          : false,
      });
    }
    if (!session?.user.id) {
      throw new ProtocolGatewayError(401, "authentication_required");
    }
    return Response.json({
      authors: await externalFollowAuthors(session.user.id),
    });
  });
}

export function POST(request: Request) {
  return protocolRoute(request, "feedback", async (id) => {
    const session = await getSessionFromApi();
    if (!session?.user.id) {
      throw new ProtocolGatewayError(401, "authentication_required");
    }
    const parsed = mutation.safeParse(await protocolJsonBody(request, 4096));
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_follow");
    }
    await consumeProtocolBudget(session.user.id, "feedback", true);
    const { actor, active } = parsed.data;
    // Removal works even when the author has disappeared or upstream is down.
    const creating =
      active && !(await externalFollowState(session.user.id, actor));
    if (creating) {
      await verifyBlueskyFollowTarget(actor, request.signal);
    }
    const author = creating
      ? await readBlueskyProfileResource(
          "profile",
          new URLSearchParams({ actor }),
          request.signal,
          id
        )
      : undefined;
    try {
      const following = await setExternalFollow(
        session.user.id,
        actor,
        active,
        author && !("items" in author) ? author : undefined
      );
      // Following expresses deliberate author interest; it must also teach the active persona.
      const settings = await readNetworkPreferences(session.user.id);
      const documentId = `follow:bluesky:${actor}`;
      if (creating && author && !("items" in author)) {
        await recordNetworkSignal(
          session.user.id,
          settings.preferences.activeProfileId,
          {
            authorId: `bluesky:${actor}`,
            createdAt: Date.now(),
            kind: "follow",
            tags: networkContentTopics(author.description ?? ""),
          },
          documentId,
          false,
          undefined,
          settings.revision
        ).catch(() => false);
      } else if (!active) {
        await Promise.all(
          settings.preferences.profiles.map((profile) =>
            removeNetworkSignal(
              session.user.id,
              profile.id,
              "follow",
              documentId
            ).catch(() => false)
          )
        );
      }
      await invalidateDiscoverySuggestions(session.user.id);
      await redis
        .publish(
          FEED_EVENTS_CHANNEL,
          JSON.stringify({
            source: "bluesky-following",
            viewerId: session.user.id,
          })
        )
        .catch(() => null);
      return Response.json({ following });
    } catch (error) {
      if (error instanceof ExternalFollowError) {
        return Response.json({ error: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}
