import {
  COMMUNITY_CHAT_TRANSCRIPT_BYTE_LIMIT,
  COMMUNITY_CHAT_TRANSCRIPT_LIMIT,
} from "./community-chat";
import type { CommunityChatMessage } from "./community-chat";

const encoder = new TextEncoder();

export function communityChatMessageBytes(
  message: CommunityChatMessage
): number {
  return encoder.encode(JSON.stringify(message)).byteLength;
}

export function mergeCommunityChatTimeline(
  current: readonly CommunityChatMessage[],
  incoming: readonly CommunityChatMessage[],
  options: {
    edge: "newer" | "older";
    maxBytes?: number;
    maxMessages?: number;
  }
): {
  bytes: number;
  messages: CommunityChatMessage[];
  trimmedAfter: boolean;
  trimmedBefore: boolean;
} {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (
      existing &&
      (message.revision < existing.revision ||
        (message.revision === existing.revision &&
          BigInt(message.changeSequence) < BigInt(existing.changeSequence)) ||
        (existing.deletedAt !== null && message.deletedAt === null))
    ) {
      continue;
    }
    byId.set(message.id, message);
  }
  const ordered = [...byId.values()].toSorted((left, right) => {
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    if (leftSequence < rightSequence) {
      return -1;
    }
    if (leftSequence > rightSequence) {
      return 1;
    }
    return left.id.localeCompare(right.id);
  });
  const maxMessages = options.maxMessages ?? COMMUNITY_CHAT_TRANSCRIPT_LIMIT;
  const maxBytes = options.maxBytes ?? COMMUNITY_CHAT_TRANSCRIPT_BYTE_LIMIT;
  const candidates = options.edge === "older" ? ordered : ordered.toReversed();
  const selected: CommunityChatMessage[] = [];
  let bytes = 0;
  for (const message of candidates) {
    const size = communityChatMessageBytes(message);
    if (selected.length >= maxMessages || bytes + size > maxBytes) {
      break;
    }
    selected.push(message);
    bytes += size;
  }
  const messages = options.edge === "older" ? selected : selected.toReversed();
  return {
    bytes,
    messages,
    trimmedAfter: options.edge === "older" && messages.length < ordered.length,
    trimmedBefore: options.edge === "newer" && messages.length < ordered.length,
  };
}
