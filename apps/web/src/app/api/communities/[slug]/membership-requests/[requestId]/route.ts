import {
  decideCommunityMembershipRequest,
  getCommunityBySlug,
  isCommunityModerator,
  prisma,
  and,
} from "@asm/db";

import {
  communityErrorResponse,
  readJsonBody,
  requireApiUser,
} from "@/communities/api-response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; requestId: string }> }
) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { slug, requestId } = await params;
  const body = await readJsonBody(request);
  if (
    !body ||
    typeof body !== "object" ||
    !("decision" in body) ||
    (body.decision !== "approve" && body.decision !== "decline")
  ) {
    return Response.json(
      { error: "Choose approve or decline" },
      { status: 400 }
    );
  }
  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    return Response.json(
      await decideCommunityMembershipRequest(
        community.id,
        user.userId,
        requestId,
        body.decision
      )
    );
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "requests.decide",
      slug,
      userId: user.userId,
    });
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; requestId: string }> }
) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { slug, requestId } = await params;
  const community = await getCommunityBySlug(slug);
  if (!community || !(await isCommunityModerator(community.id, user.userId))) {
    return Response.json({ canDecide: false, pending: false }, { status: 404 });
  }
  const pending = Boolean(
    await prisma.orm.public.CommunityMembers.select("id")
      .where((row) =>
        and(
          row.id.eq(requestId),
          row.communityId.eq(community.id),
          row.status.eq("PENDING")
        )
      )
      .first()
  );
  return Response.json(
    { canDecide: true, pending },
    { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
  );
}
