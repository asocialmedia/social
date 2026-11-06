import { getCommunityChatInbox } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatAvailabilityResponse } from "@/lib/communities/chat-api";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to view your communities" },
      { status: 401 }
    );
  }
  const unavailable = communityChatAvailabilityResponse();
  if (unavailable) {
    return unavailable;
  }
  try {
    return Response.json(
      { communities: await getCommunityChatInbox(session.user.id) },
      { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
    );
  } catch {
    return Response.json(
      { error: "Couldn't load community chats" },
      { status: 503 }
    );
  }
}
