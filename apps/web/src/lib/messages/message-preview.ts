// The one line a conversation list shows for a message nobody has decrypted yet.
//
// The server stores only ciphertext and cannot produce this, so it is derived on
// the client from the payload -- which is also why it has to be a pure function
// with its own tests: it is the only description of a chat that exists before the
// reader opens it.
//
// Deliberately NOT the same string as the transcript's quote label. A quote of a
// captioned photo says "Shared an image", because a quote has no room for the
// caption and the picture is the point. A list preview has no picture, so the
// caption IS the message and printing "Shared an image" instead would throw away
// the only words the sender wrote.

import { getMediaImages } from "@/lib/messages/crypto";
import type { MessagePayload } from "@/lib/messages/crypto";

// Collapses the whitespace a message body may carry (newlines, runs of spaces)
// into single spaces, so a preview is one line the row can truncate rather than a
// block that changes the row's height. Truncation itself is left to CSS `truncate`,
// so the ellipsis lands where the row actually ends instead of at a fixed count.
function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

// What a message says, in as few words as its payload allows.
export function messagePreviewText(payload: MessagePayload): string {
  const caption =
    typeof payload.content === "string" ? oneLine(payload.content) : "";
  if (caption.length > 0) {
    return caption;
  }
  if (payload.type === "post") {
    return "Shared a post";
  }
  if (payload.type === "media") {
    if (payload.kind === "gif") {
      return "Shared a GIF";
    }
    const count = getMediaImages(payload).length;
    return count > 1 ? `Shared ${count} images` : "Shared an image";
  }
  // A text message always carries a body, so an empty one here is a payload this
  // build does not recognise rather than a message with nothing in it. Say nothing
  // rather than inventing a description.
  return "";
}

// The full line for a list row: the sender's own framing, and the one case where
// the row is about the conversation rather than about what was said.
//
// `deleted` wins over everything: a message that was deleted says so, whatever its
// ciphertext still decrypts to, because the sender took it back. It does not say
// who deleted it -- the row is about the conversation, and a deleted own message
// reading "You deleted this" while the list is meant to show what was said is more
// detail than it earns.
export function conversationPreviewText(input: {
  deleted: boolean;
  mine: boolean;
  payload: MessagePayload | undefined;
}): string {
  if (input.deleted) {
    return "This message was deleted";
  }
  if (!input.payload) {
    // Not decrypted, not decryptable, or evicted from the cache. An empty line
    // reads as a conversation with no messages, which is a different fact.
    return "";
  }
  const text = messagePreviewText(input.payload);
  if (text.length === 0) {
    return "";
  }
  return input.mine ? `You: ${text}` : text;
}
