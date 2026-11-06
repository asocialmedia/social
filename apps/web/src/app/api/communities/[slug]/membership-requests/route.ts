import { getCommunityBySlug, listCommunityMembershipRequests } from "@asm/db";

import {
  communityErrorResponse,
  requireApiUser,
} from "@/communities/api-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { slug } = await params;
  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    const url = new URL(request.url);
    const result = await listCommunityMembershipRequests(
      community.id,
      user.userId,
      url.searchParams.get("cursor") ?? undefined
    );
    return Response.json(result, {
      headers: { "cache-control": "private, no-store", vary: "Cookie" },
    });
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "requests.list",
      slug,
      userId: user.userId,
    });
  }
}
