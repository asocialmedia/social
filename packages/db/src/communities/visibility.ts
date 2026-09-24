import { and, or } from "@prisma/orm-postgres/orm-client";
import type { ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { AnyExpression } from "@prisma/orm-postgres/relational-core/ast";

import type { Contract } from "../../generated/prisma/contract";

export function communityVisibilityWhere(
  userId: string
): (post: ModelAccessor<Contract, "Posts", "public">) => AnyExpression {
  return (post) => {
    const readableCommunity = (
      community: ModelAccessor<Contract, "Communities", "public">
    ) =>
      userId
        ? or(
            community._type.neq("PRIVATE"),
            community.communityMembers.some((member) =>
              and(member.status.eq("ACTIVE"), member.userId.eq(userId))
            )
          )
        : community._type.neq("PRIVATE");

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
