import {
  canViewCommunity,
  CommunityChatError,
  createCommunityChatChannel,
  getCommunityBySlug,
  listCommunityChatChannels,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const unavailable = communityChatAvailabilityResponse(false);
  if (unavailable) {
    return unavailable;
  }
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  try {
    return Response.json(
      await listCommunityChatChannels(community.id, userId),
      {
        headers: { "cache-control": "private, no-store", vary: "Cookie" },
      }
    );
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to manage community chat" },
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid channel details" }, { status: 400 });
  }
  const channel = body as {
    channelType?: unknown;
    name?: unknown;
    topic?: unknown;
  };
  if (
    typeof channel.name !== "string" ||
    (channel.channelType !== "TEXT" &&
      channel.channelType !== "ANNOUNCEMENT") ||
    (channel.topic !== undefined && typeof channel.topic !== "string")
  ) {
    return Response.json({ error: "Invalid channel details" }, { status: 400 });
  }
  try {
    const created = await createCommunityChatChannel({
      channelType: channel.channelType,
      communityId: community.id,
      creatorId: userId,
      name: channel.name,
      topic: channel.topic,
    });
    return Response.json({ channel: created }, { status: 201 });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
