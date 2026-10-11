import type { MessagePage } from "@/lib/messages/types";

export const MAX_MESSAGE_HISTORY_RESPONSE_BYTES = 1_048_576;

export type MessagePageDirection = "around" | "newer" | "older";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializedPageSize(
  page: MessagePage,
  messageBytes: readonly number[]
): number {
  const envelope = JSON.stringify({ ...page, messages: [] });
  return (
    utf8ByteLength(envelope) +
    messageBytes.reduce((total, bytes) => total + bytes, 0) +
    Math.max(messageBytes.length - 1, 0)
  );
}

export function createBoundedMessagePageResponse(
  source: MessagePage,
  direction: MessagePageDirection,
  maxBytes = MAX_MESSAGE_HISTORY_RESPONSE_BYTES
): Response {
  const messages = [...source.messages];
  const messageBytes = messages.map((message) =>
    utf8ByteLength(JSON.stringify(message))
  );
  let { anchorIndex } = source;
  let trimmedOlder = false;
  let trimmedNewer = false;
  let page: MessagePage = source;

  while (
    serializedPageSize(page, messageBytes) > maxBytes &&
    messages.length > 1
  ) {
    const removeOlder =
      direction === "older" ||
      (direction === "around" &&
        (anchorIndex === undefined ||
          anchorIndex < 0 ||
          (anchorIndex > 0 &&
            anchorIndex >= messages.length - anchorIndex - 1)));

    if (removeOlder) {
      messages.shift();
      messageBytes.shift();
      trimmedOlder = true;
      if (anchorIndex !== undefined && anchorIndex >= 0) {
        anchorIndex -= 1;
      }
    } else {
      messages.pop();
      messageBytes.pop();
      trimmedNewer = true;
    }

    const [oldest] = messages;
    const newest = messages.at(-1);
    page = {
      ...source,
      anchorIndex,
      messages,
      nextCursor: trimmedNewer && newest ? newest.id : source.nextCursor,
      previousCursor:
        trimmedOlder && oldest ? oldest.id : source.previousCursor,
    };
  }

  const body = JSON.stringify(page);
  if (utf8ByteLength(body) > maxBytes) {
    return Response.json(
      { error: "A message is too large to include in this history page." },
      { status: 413 }
    );
  }
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status: 200,
  });
}
