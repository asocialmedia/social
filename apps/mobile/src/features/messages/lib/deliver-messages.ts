import { messageAttachmentKind } from "@asm/media";

import type { MessagePayload } from "./crypto";

interface ComposerAttachment {
  file: {
    durationMs?: number | null;
    height?: number;
    mimeType: string;
    name: string;
    size: number;
    width?: number;
  };
  mediaId: string | null;
  viewOnce?: boolean;
}

interface ReplyTarget {
  id: string;
  senderId: string;
}

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
  await onSend({
    attachments: attachments.map(toMediaAttachment),
    content:
      input.postId || attachments.some((item) => item.viewOnce)
        ? undefined
        : caption || undefined,
    replyToId: input.postId ? undefined : replyTo?.id,
    replyToSenderId: input.postId ? undefined : replyTo?.senderId,
    type: "media",
  });
}

function toMediaAttachment(item: ComposerAttachment) {
  if (!item.mediaId) {
    throw new Error("Wait for uploads to finish before sending.");
  }
  if (item.viewOnce) {
    return {
      height: item.file.height,
      kind: "view-once" as const,
      ref: item.mediaId,
    };
  }
  const url = `/api/media/${item.mediaId}`;
  const kind = messageAttachmentKind(item.file.mimeType);
  if (kind === "video") {
    return {
      durationSec: item.file.durationMs
        ? item.file.durationMs / 1000
        : undefined,
      height: item.file.height,
      kind,
      url,
      width: item.file.width,
    };
  }
  if (kind === "file") {
    return {
      bytes: item.file.size,
      filename: item.file.name,
      kind,
      mimeType: item.file.mimeType,
      url,
    };
  }
  if (kind === "image" || kind === "gif") {
    return {
      height: item.file.height,
      kind,
      url,
      width: item.file.width,
    };
  }
  throw new Error("This file type can't be sent in a message.");
}
