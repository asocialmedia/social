import { randomUUID } from "node:crypto";

import { and, or } from "@prisma/orm-postgres/orm-client";

import { enqueueNotificationCreated } from "../../queue";
import prisma, { toPrismaDateTime } from "../prisma";
import type { PrismaOrm, PrismaTransaction } from "../prisma";
import { consumeRateLimitSliding } from "../rate-limit";
import { CommunityError } from "./errors";

export async function communityUserIsBanned(
  communityId: string,
  userId: string,
  orm: PrismaOrm = prisma.orm
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const now = toPrismaDateTime(new Date());
  return Boolean(
    await orm.public.CommunityChatSanctions.select("id")
      .where((row) =>
        and(
          row.communityId.eq(communityId),
          row.userId.eq(userId),
          row.kind.eq("BAN"),
          or(row.expiresAt.isNull(), row.expiresAt.gt(now))
        )
      )
      .first()
  );
}

export async function assertCommunityRequestRate(
  communityId: string,
  userId: string
): Promise<void> {
  const limits = await Promise.all([
    consumeRateLimitSliding({
      bucket: "community-request",
      identifier: `${userId}:${communityId}`,
      limit: 5,
      windowSeconds: 600,
    }),
    consumeRateLimitSliding({
      bucket: "community-request-user",
      identifier: userId,
      limit: 20,
      windowSeconds: 3600,
    }),
  ]);
  if (limits.some((limit) => !limit.allowed)) {
    throw new CommunityError(
      "RATE_LIMITED",
      "Too many membership requests. Try again later."
    );
  }
}

export async function notifyCommunityJoinRequest(
  transaction: PrismaTransaction,
  input: { communityId: string; userId: string; requestId: string }
): Promise<void> {
  const staff = await transaction.orm.public.CommunityMembers.select("userId")
    .where((row) =>
      and(
        row.communityId.eq(input.communityId),
        row.status.eq("ACTIVE"),
        row.role.in(["OWNER", "MODERATOR"])
      )
    )
    .all();
  if (staff.length) {
    await transaction.orm.public.Notifications.createAll(
      staff.map((member) => ({
        _type: "COMMUNITY_JOIN_REQUEST" as const,
        communityId: input.communityId,
        id: randomUUID(),
        issuerId: input.userId,
        membershipRequestId: input.requestId,
        recipientId: member.userId,
      }))
    );
  }
}

export async function deliverCommunityMembershipNotifications(
  communityId: string,
  requestId: string
): Promise<void> {
  const rows = await prisma.orm.public.Notifications.select("id", "recipientId")
    .where((row) =>
      and(
        row.communityId.eq(communityId),
        row.membershipRequestId.eq(requestId)
      )
    )
    .all();
  await Promise.allSettled(
    rows.map((row) => enqueueNotificationCreated(row.recipientId, row.id))
  );
}
