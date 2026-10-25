import {
  and,
  getCommunityChatMessage,
  getCommunityChatMessageRoomAccess,
  prisma,
} from "@asm/db";
import { isStickerMessagePayload } from "@asm/messages/payload";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const { messageId } = await context.params;
  try {
    const access = await getCommunityChatMessageRoomAccess(messageId, userId);
    const message = await getCommunityChatMessage({
      messageId,
      roomId: access.room.id,
      userId,
    });
    if (!message.payload || !isStickerMessagePayload(message.payload)) {
      return new Response(null, { status: 404 });
    }
    const { mediaId } = message.payload.sticker;
    const media = await prisma.orm.public.PostMedia.where({
      id: mediaId,
      status: "READY",
    }).first();
    if (!media) {
      return new Response(null, { status: 404 });
    }
    const full = await prisma.orm.public.PostMediaDerivatives.where((row) =>
      and(
        row.mediaId.eq(mediaId),
        row.kind.eq("sticker"),
        row.variant.eq("full")
      )
    ).first();
    if (!full) {
      return new Response(null, { status: 404 });
    }
    const object = await asmobClient.send(
      new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: full.key })
    );
    return new Response(object.Body?.transformToWebStream(), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
