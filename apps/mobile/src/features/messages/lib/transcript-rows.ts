// Build forward chronology first, then invert the complete rows for FlatList.
// Dividers remain above the messages they label even after the list is inverted.
import { reversedCopy } from "@/lib/ordered-copy";

import { formatTimeDivider, getMessageGroupMeta } from "./message-grouping";
import type { MessageData } from "./types";

export type TranscriptItem =
  | { key: string; kind: "message"; message: MessageData }
  | { key: string; kind: "divider"; label: string }
  | { key: string; kind: "unread" };

export function buildTranscriptRows(
  messages: MessageData[],
  unreadId: string | null
): TranscriptItem[] {
  const rows: TranscriptItem[] = [];
  for (const [index, message] of messages.entries()) {
    if (getMessageGroupMeta(messages, index).showTimeDivider) {
      const label = formatTimeDivider(message.createdAt);
      if (label) {
        rows.push({ key: `divider-${message.id}`, kind: "divider", label });
      }
    }
    if (message.id === unreadId) {
      rows.push({ key: `unread-${message.id}`, kind: "unread" });
    }
    rows.push({ key: message.id, kind: "message", message });
  }
  return reversedCopy(rows);
}
