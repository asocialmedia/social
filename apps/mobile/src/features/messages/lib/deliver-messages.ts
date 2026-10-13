import type { MessagePayload } from "./crypto";

interface ComposerAttachment {
  file: { mimeType: string; width?: number; height?: number };
  mediaId: string | null;
}
interface ReplyTarget {
  id: string;
  senderId: string;
}

// Deliver each media kind separately, with the caption only on the first message.
export async function deliverMessages(input: {
  attachments: ComposerAttachment[];
  postId?: string;
  caption: string;
  onSend: (payload: MessagePayload) => Promise<void>;
  replyTo: ReplyTarget | null;
}): Promise<void> {
  const { attachments, caption, onSend, replyTo } = input;
  if (input.postId) {
    await onSend({
      content: caption || undefined,
      postId: input.postId,
      replyToId: replyTo?.id,
      replyToSenderId: replyTo?.senderId,
      type: "post",
    });
    if (attachments.length === 0) {
      return;
    }
  }
  if (attachments.length === 0) {
    await onSend({
      content: caption,
      replyToId: replyTo?.id,
      replyToSenderId: replyTo?.senderId,
      type: "text",
    });
    return;
  }
  const photos = attachments.filter(
    (item) => item.file.mimeType !== "image/gif"
  );
  const gifs = attachments.filter((item) => item.file.mimeType === "image/gif");
  if (photos.length > 0) {
    await onSend(
      buildMediaPayload(photos, "image", input.postId ? "" : caption, replyTo)
    );
  }
  if (gifs.length > 0) {
    await onSend(
      buildMediaPayload(
        gifs,
        "gif",
        input.postId || photos.length ? "" : caption,
        replyTo
      )
    );
  }
}

function buildMediaPayload(
  items: ComposerAttachment[],
  kind: "gif" | "image",
  caption: string,
  replyTo: ReplyTarget | null
): MessagePayload {
  return {
    content: caption || undefined,
    images: items.map((item) => ({
      height: item.file.height,
      url: `/api/media/${item.mediaId}`,
      width: item.file.width,
    })),
    kind,
    replyToId: replyTo?.id,
    replyToSenderId: replyTo?.senderId,
    type: "media",
  };
}
