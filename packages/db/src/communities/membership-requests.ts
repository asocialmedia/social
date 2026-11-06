import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { fromPrismaDateTime, toPrismaDateTime } from "../prisma";
import {
  invalidateCommunityPopulationAggregates,
  invalidateCommunityStats,
} from "./aura";
import {
  communityUserIsBanned,
  deliverCommunityMembershipNotifications,
} from "./membership-policy";
import {
  CommunityError,
  claimCommunityMutation,
  approveMember,
  getMembership,
  isCommunityModerator,
} from "./service";

export async function getCommunityPreview(slug: string, userId: string) {
  const row = await prisma.orm.public.Communities.select(
    "id",
    "slug",
    "name",
    "description",
    "avatarUrl",
    "bannerUrl",
    "accentColor",
    "topics",
    "mature",
    "_type",
    "activeMemberCount"
  )
    .where({ slug })
    .first();
  if (!row) {
    return null;
  }
  const [membership, banned] = await Promise.all([
    userId ? getMembership(row.id, userId) : null,
    communityUserIsBanned(row.id, userId),
  ]);
  const active = membership?.status === "ACTIVE" && !banned;
  return {
    community: {
      accentColor: row.accentColor,
      avatarUrl: row.avatarUrl,
      bannerUrl: row.bannerUrl,
      description: row.description,
      id: row.id,
      mature: row.mature,
      memberCount: row.activeMemberCount,
      name: row.name,
      slug: row.slug,
      topics: row.topics,
      type: row._type,
    },
    membership,
    permissions: {
      banned,
      canModerate:
        active &&
        (membership?.role === "OWNER" || membership?.role === "MODERATOR"),
      canReadChat: row._type === "PUBLIC" || active,
      canReadContent: row._type !== "PRIVATE" || active,
      canRequest: Boolean(userId) && !banned && !membership,
    },
  };
}

export async function listCommunityMembershipRequests(
  communityId: string,
  actorId: string,
  cursor?: string,
  pageSize = 25
): Promise<{
  requests: {
    id: string;
    userId: string;
    createdAt: string;
    user: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      bannerUrl: string | null;
    } | null;
  }[];
  total: number;
  nextCursor: string | null;
}> {
  if (!(await isCommunityModerator(communityId, actorId))) {
    throw new CommunityError(
      "FORBIDDEN",
      "Only community staff can review requests"
    );
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(pageSize) || 25));
  let query = prisma.orm.public.CommunityMembers.select(
    "id",
    "createdAt",
    "userId"
  )
    .include("user", (user) =>
      user.select("id", "username", "displayName", "avatarUrl", "bannerUrl")
    )
    .where((row) =>
      and(row.communityId.eq(communityId), row.status.eq("PENDING"))
    )
    .orderBy([(row) => row.createdAt.asc(), (row) => row.id.asc()])
    .limit(limit + 1);
  if (cursor) {
    const [date, id] = cursor.split("|");
    const timestamp = new Date(date ?? "");
    if (!id || !Number.isFinite(timestamp.getTime())) {
      throw new CommunityError("INVALID_SLUG", "Invalid request cursor");
    }
    query = query.cursor({ createdAt: toPrismaDateTime(timestamp), id });
  }
  const [rows, total] = await Promise.all([
    query.all(),
    prisma.orm.public.CommunityMembers.where((row) =>
      and(row.communityId.eq(communityId), row.status.eq("PENDING"))
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);
  const requests = rows.slice(0, limit).map((row) => ({
    ...row,
    createdAt: fromPrismaDateTime(row.createdAt).toISOString(),
  }));
  const last = requests.at(-1);
  return {
    nextCursor:
      rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
    requests,
    total: total.count,
  };
}

export async function decideCommunityMembershipRequest(
  communityId: string,
  actorId: string,
  requestId: string,
  decision: "approve" | "decline"
) {
  if (decision === "approve") {
    const applied = await approveMember(communityId, actorId, "", requestId);
    if (applied) {
      await Promise.all([
        invalidateCommunityStats(communityId),
        invalidateCommunityPopulationAggregates(),
      ]);
    }
    return { applied, decision };
  }
  const result = await prisma.transaction(async (transaction) => {
    await claimCommunityMutation(transaction, communityId);
    const actor = await transaction.orm.public.CommunityMembers.select(
      "role",
      "status"
    )
      .where((row) =>
        and(row.communityId.eq(communityId), row.userId.eq(actorId))
      )
      .first();
    if (
      actor?.status !== "ACTIVE" ||
      !["OWNER", "MODERATOR"].includes(actor.role)
    ) {
      throw new CommunityError(
        "FORBIDDEN",
        "Only community staff can review requests"
      );
    }
    if (await communityUserIsBanned(communityId, actorId, transaction.orm)) {
      throw new CommunityError("FORBIDDEN", "You cannot manage this community");
    }
    const request = await transaction.orm.public.CommunityMembers.select(
      "userId"
    )
      .where((row) =>
        and(
          row.id.eq(requestId),
          row.communityId.eq(communityId),
          row.status.eq("PENDING")
        )
      )
      .first();
    if (!request) {
      return { applied: false, decision };
    }
    await transaction.orm.public.CommunityMembers.where({
      id: requestId,
    }).deleteAndCount();
    await transaction.orm.public.Notifications.create({
      _type: "COMMUNITY_JOIN_DECLINED",
      communityId,
      issuerId: actorId,
      membershipRequestId: requestId,
      recipientId: request.userId,
    });
    return { applied: true, decision };
  });
  await deliverCommunityMembershipNotifications(communityId, requestId);
  return result;
}

export async function cancelCommunityMembershipRequest(
  communityId: string,
  userId: string
): Promise<void> {
  await prisma.transaction(async (transaction) => {
    await claimCommunityMutation(transaction, communityId);
    await transaction.orm.public.CommunityMembers.where((row) =>
      and(
        row.communityId.eq(communityId),
        row.userId.eq(userId),
        row.status.eq("PENDING")
      )
    ).deleteAndCount();
  });
}
