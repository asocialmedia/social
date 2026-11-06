import {
  getCommunityChatMessage,
  getCommunityChatMessageRoomAccess,
  prisma,
  rawQuery,
} from "@asm/db";
import { readSqlBundle as readExtractedSqlBundle } from "@asm/db/sql-template";
import { isStickerMessagePayload } from "@asm/messages/payload";
import { z } from "zod";

import { resolveMessageMediaMembership } from "@/lib/media/message-media-access";

import extractedSqlSource from "./sticker-library.sql" with { type: "text" };

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: ["statement1"],
} as const);

export const stickerMessageSchema = z.object({
  mediaId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  source: z.enum(["messages", "community"]).default("messages"),
});

export function stickerOriginMediaId(media: {
  id: string;
  techMetadata?: unknown;
}) {
  const metadata = media.techMetadata;
  return metadata &&
    typeof metadata === "object" &&
    "stickerOriginMediaId" in metadata &&
    typeof metadata.stickerOriginMediaId === "string" &&
    metadata.stickerOriginMediaId.length > 0
    ? metadata.stickerOriginMediaId
    : media.id;
}

export async function resolveStickerSource(
  input: z.infer<typeof stickerMessageSchema>,
  userId: string
) {
  const source = await prisma.orm.public.PostMedia.where({
    id: input.mediaId,
  }).first();
  if (
    !source ||
    source.status !== "READY" ||
    source.messageViewOnce ||
    source.incognitoSessionId
  ) {
    return null;
  }
  if (input.source === "community") {
    try {
      const access = await getCommunityChatMessageRoomAccess(
        input.messageId,
        userId
      );
      const message = await getCommunityChatMessage({
        messageId: input.messageId,
        roomId: access.room.id,
        userId,
      });
      return message.payload &&
        isStickerMessagePayload(message.payload) &&
        message.payload.sticker.mediaId === input.mediaId
        ? source
        : null;
    } catch {
      return null;
    }
  }
  if (
    !source.messageConversationId ||
    !(await resolveMessageMediaMembership(
      source.messageConversationId,
      userId,
      source.id
    ))
  ) {
    return null;
  }
  const link = await prisma.orm.public.MessageMediaLinks.where({
    mediaId: source.id,
    messageId: input.messageId,
  }).first();
  if (!link || link.viewOnce) {
    return null;
  }
  const message = await prisma.orm.public.Messages.where({
    id: input.messageId,
  }).first();
  return message && !message.deletedAt && !message.expiresAt ? source : null;
}

export async function findStickerLibraryEntry(
  userId: string,
  source: { id: string; techMetadata?: unknown },
  tx?: Parameters<typeof rawQuery>[3]
) {
  const result = await rawQuery<{ id: string; favorite: boolean }>(
    extractedSql.statement1,
    [userId, source.id, stickerOriginMediaId(source)],
    { favorite: "pg/bool@1", id: "pg/text@1" },
    tx
  );
  return result.rows[0] ?? null;
}
