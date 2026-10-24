import { prisma } from "@asm/db";
import { externalUriSchema } from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { blueskyLike } from "@/lib/protocols/bluesky-like";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolJsonBody,
  protocolRoute,
} from "@/lib/protocols/gateway";
import {
  blueskyConnectionPermissions,
  blueskyOAuthLexClient,
} from "@/lib/protocols/oauth";

const inputSchema = z
  .object({ active: z.boolean(), uri: externalUriSchema })
  .strict();
async function accountFor(userId: string) {
  return await prisma.orm.public.Accounts.where({
    providerId: "bluesky",
    userId,
  }).first();
}

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async () => {
    const session = await getSessionFromApi();
    const account = session?.user.id ? await accountFor(session.user.id) : null;
    const permissions = {
      ...blueskyConnectionPermissions(account?.idToken),
      did: account?.accountId ?? null,
    };
    const uri = new URL(request.url).searchParams.get("uri");
    if (!uri || !permissions.canLike || !session || !account) {
      return Response.json(permissions);
    }
    const parsed = externalUriSchema.safeParse(uri);
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_uri");
    }
    await consumeProtocolBudget(session.user.id, "read", true);
    const client = await blueskyOAuthLexClient(
      session.user.id,
      account.accountId
    );
    return Response.json({
      ...permissions,
      ...(await blueskyLike(client, parsed.data)),
    });
  });
}

export function POST(request: Request) {
  return protocolRoute(request, "feedback", async () => {
    const session = await getSessionFromApi();
    if (!session?.user.id) {
      throw new ProtocolGatewayError(401, "sign_in_required");
    }
    const parsed = inputSchema.safeParse(await protocolJsonBody(request, 2048));
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_like");
    }
    await consumeProtocolBudget(session.user.id, "feedback", true);
    const account = await accountFor(session.user.id);
    if (!account || !blueskyConnectionPermissions(account.idToken).canLike) {
      throw new ProtocolGatewayError(409, "bluesky_connection_required");
    }
    const client = await blueskyOAuthLexClient(
      session.user.id,
      account.accountId
    );
    return Response.json(
      await blueskyLike(client, parsed.data.uri, parsed.data.active)
    );
  });
}
