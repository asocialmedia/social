import type { IncognitoSession } from "@asm/messages";

// Build forward chronology first, then invert the complete rows for FlatList.
// Dividers remain above the messages they label even after the list is inverted.
import { reversedCopy } from "@/lib/format/ordered-copy";

import { formatTimeDivider, getMessageGroupMeta } from "./message-grouping";
import type { MessageData } from "./types";

export type TranscriptItem =
  | { key: string; kind: "incognito"; session: IncognitoSession }
  | { key: string; kind: "message"; message: MessageData }
  | { key: string; kind: "divider"; label: string }
  | { key: string; kind: "unread" };

export function buildTranscriptRows(
  messages: MessageData[],
  unreadId: string | null,
  notices: readonly IncognitoSession[] = []
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
  if (notices.length) {
    for (const session of notices) {
      rows.push({ key: `incognito-${session.id}`, kind: "incognito", session });
    }
    const timestampByKey = new Map(
      messages.map((message) => [
        message.id,
        new Date(message.createdAt).getTime(),
      ])
    );
    const at = (row: TranscriptItem): number =>
      (() => {
        if (row.kind === "incognito") {
          return Date.parse(row.session.startedAt);
        }
        if (row.kind === "message") {
          return new Date(row.message.createdAt).getTime();
        }
        return (
          timestampByKey.get(row.key.replace(/^(?:divider-|unread-)/u, "")) ?? 0
        );
      })();
    rows.sort((a, b) => at(a) - at(b));
  }
  return reversedCopy(rows);
}
