import { externalPostStates } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolRoute,
} from "@/lib/protocols/gateway";
import { readBlueskyProfileResource } from "@/lib/protocols/service";

const profileQuery = z.object({
  actor: z
    .string()
    .min(3)
    .max(256)
    .regex(
      /^(?:did:(?:plc|web):[A-Za-z0-9._:%-]+|[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)$/
    ),
  cursor: z.string().min(1).max(4096).optional(),
  tab: z.enum(["posts", "replies", "media"]).optional(),
});

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async (id) => {
    const parsed = profileQuery.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_query");
    }
    const session = await getSessionFromApi();
    if (session?.user.id) {
      await consumeProtocolBudget(session.user.id, "read", true);
    }
    const params = new URLSearchParams({ actor: parsed.data.actor });
    if (parsed.data.tab) {
      params.set("tab", parsed.data.tab);
    }
    if (parsed.data.cursor) {
      params.set("cursor", parsed.data.cursor);
    }
    const resource = await readBlueskyProfileResource(
      parsed.data.tab ? "author-feed" : "profile",
      params,
      request.signal,
      id
    );
    if (!("items" in resource)) {
      return Response.json(resource);
    }
    const states = await externalPostStates(
      resource.items.map((post) => post.id),
      session?.user.id
    );
    return Response.json({
      ...resource,
      items: resource.items.map((post) => ({
        ...post,
        asm: states.get(post.id),
      })),
    });
  });
}
