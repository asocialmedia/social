import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatMuted,
  setCommunityChatMuted,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to view chat preferences" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  try {
    return Response.json(
      await getCommunityChatMuted({ communityId: community.id, userId })
    );
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to update chat preferences" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid chat preference" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid chat preference" }, { status: 400 });
  }
  const input = body as { muted?: unknown };
  if (typeof input.muted !== "boolean") {
    return Response.json({ error: "Invalid chat preference" }, { status: 400 });
  }
  try {
    return Response.json(
      await setCommunityChatMuted({
        communityId: community.id,
        muted: input.muted,
        userId,
      })
    );
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
