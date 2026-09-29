import { and } from "@prisma/orm-postgres/orm-client";
import type { ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { AnyExpression } from "@prisma/orm-postgres/relational-core/ast";

import type { Contract } from "../../generated/prisma/contract";
import { toPrismaDateTime } from "../dates";

type MessageAccessor = ModelAccessor<Contract, "Messages", "public">;

// The per-user visibility filter for "delete for me": a message is visible to
// `userId` unless a MessageHidden row names them. Combine into any message
// `where` (thread pages, list previews) so a hidden message can never leak back
// through a query that forgot the join.
export function visibleToUser(
  userId: string
): (message: MessageAccessor) => AnyExpression {
  return (message) =>
    message.hiddenFor.none((hidden) => hidden.userId.eq(userId));
}

// The where clause shared by every unread-message count: the current user's own
// sent messages never accrue a badge (the writer only increments the peer),
// soft-deleted messages are not counted, and messages the user hid with "delete
// for me" drop out too. Kept in one place so the read, list, and badge-seed
// routes cannot drift.
export function unreadMessageWhere(params: {
  conversationId: string;
  lastReadAt: Date | null;
  userId: string;
}): (message: MessageAccessor) => AnyExpression {
  return (message) =>
    and(
      message.conversationId.eq(params.conversationId),
      message.createdAt.gt(toPrismaDateTime(params.lastReadAt ?? new Date(0))),
      message.deletedAt.isNull(),
      message.hiddenFor.none((hidden) => hidden.userId.eq(params.userId)),
      message.senderId.notIn([params.userId])
    );
}
