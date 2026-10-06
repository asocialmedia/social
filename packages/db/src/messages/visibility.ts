import { and, or } from "@prisma/orm-postgres/orm-client";
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
//
// The multi-conversation form, because the badge seed's question is about every
// conversation a reader is in at once and a reader can be in as many as they
// like. A caller that answered that with one `aggregate` per conversation issued
// one round trip per row of their own inbox - hundreds of concurrent queries for
// one number - and the conversation list was already answering the identical
// question with one grouped read. This is that read.
//
// Each OR branch carries its OWN watermark rather than one global earliest: a
// never-read thread would otherwise drag in every message in every other
// conversation the reader has, which is both wrong and slower.
//
// A branch may also carry the reader's membership WINDOWS for that conversation:
// the stretches of a den transcript they were actually inside for, one bounded
// range per stint. A reader who left a den and came back is shown neither stint's
// gap in the transcript, and the badge must not count what the thread refuses to
// show, or it advertises messages that open to nothing. Omitted windows (every
// DM, and every membership that never broke) apply no range at all, which keeps
// the branch exactly what it was before windows existed.
export function unreadMessagesWhere(params: {
  userId: string;
  watermarks: readonly {
    conversationId: string;
    lastReadAt: Date | null;
    windows?: readonly { after: Date | null; before: Date | null }[];
  }[];
}): (message: MessageAccessor) => AnyExpression {
  return (message) =>
    and(
      or(
        ...params.watermarks.map((watermark) => {
          const branch = and(
            message.conversationId.eq(watermark.conversationId),
            message.createdAt.gt(
              toPrismaDateTime(watermark.lastReadAt ?? new Date(0))
            )
          );
          const ranges = (watermark.windows ?? [])
            .map((window) => {
              const bounds = [];
              if (window.after !== null) {
                bounds.push(
                  message.createdAt.gte(toPrismaDateTime(window.after))
                );
              }
              if (window.before !== null) {
                bounds.push(
                  message.createdAt.lte(toPrismaDateTime(window.before))
                );
              }
              return bounds.length === 0 ? null : and(...bounds);
            })
            .filter((range) => range !== null);
          // A window with neither bound admits the whole transcript, so no range
          // is applied at all unless every window is bounded.
          if (ranges.length === (watermark.windows ?? []).length) {
            return and(branch, or(...ranges));
          }
          return branch;
        })
      ),
      message.deletedAt.isNull(),
      message.hiddenFor.none((hidden) => hidden.userId.eq(params.userId)),
      message.senderId.notIn([params.userId])
    );
}

// The single-conversation form, expressed AS the multi-conversation form with one
// entry. Not a convenience wrapper: it is the reason the two cannot drift, and
// the reason the three message-level rules above exist once rather than twice.
export function unreadMessageWhere(params: {
  conversationId: string;
  lastReadAt: Date | null;
  userId: string;
}): (message: MessageAccessor) => AnyExpression {
  return unreadMessagesWhere({
    userId: params.userId,
    watermarks: [
      {
        conversationId: params.conversationId,
        lastReadAt: params.lastReadAt,
      },
    ],
  });
}
