import { and, or } from "@prisma/orm-postgres/orm-client";
import type { ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { AnyExpression } from "@prisma/orm-postgres/relational-core/ast";

import type { Contract } from "../../generated/prisma/contract";
import { toPrismaDateTime } from "../prisma";

export function communityVisibilityWhere(
  userId: string
): (post: ModelAccessor<Contract, "Posts", "public">) => AnyExpression {
  return (post) => {
    const readableCommunity = communityContentVisibilityWhere(userId);

    return or(
      and(post.communityId.isNull(), post.communityPostShares.none()),
      post.community.some(readableCommunity),
      post.communityPostShares.some((share) =>
        share.community.some(readableCommunity)
      )
    );
  };
}

export type PostVisibilityFilter = ReturnType<typeof communityVisibilityWhere>;

export function communityContentVisibilityWhere(
  userId: string
): (
  community: ModelAccessor<Contract, "Communities", "public">
) => AnyExpression {
  const now = toPrismaDateTime(new Date());
  return (community) =>
    userId
      ? or(
          community._type.neq("PRIVATE"),
          and(
            community.communityMembers.some((member) =>
              and(member.status.eq("ACTIVE"), member.userId.eq(userId))
            ),
            community.communityChatSanctions.none((sanction) =>
              and(
                sanction.userId.eq(userId),
                sanction.kind.eq("BAN"),
                or(sanction.expiresAt.isNull(), sanction.expiresAt.gt(now))
              )
            )
          )
        )
      : community._type.neq("PRIVATE");
}

export function communityNotificationVisibilityWhere(
  userId: string
): (
  notification: ModelAccessor<Contract, "Notifications", "public">
) => AnyExpression {
  return (notification) =>
    and(
      or(
        notification.commentId.isNull(),
        notification.comment.some((comment) =>
          comment.post.some(communityVisibilityWhere(userId))
        )
      ),
      or(
        notification.postId.isNull(),
        notification.post.some(communityVisibilityWhere(userId))
      ),
      or(
        notification.communityId.isNull(),
        notification._type.in([
          "COMMUNITY_JOIN_APPROVED",
          "COMMUNITY_JOIN_DECLINED",
        ]),
        notification.community.some(communityContentVisibilityWhere(userId))
      ),
      or(
        notification._type.neq("COMMUNITY_JOIN_REQUEST"),
        notification.community.some((community) =>
          community.communityMembers.some((member) =>
            and(
              member.userId.eq(userId),
              member.status.eq("ACTIVE"),
              member.role.in(["OWNER", "MODERATOR"])
            )
          )
        )
      )
    );
}
