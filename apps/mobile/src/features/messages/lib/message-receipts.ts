// Delivery/read receipts for a message's options sheet.
//
// Receipts are watermark-based: the server stores one `lastDeliveredAt` and one
// `lastReadAt` per conversation member (the newest message that member has acked /
// read) instead of a row per message. A message's receipt is therefore a pure
// comparison against the peer's watermarks -- no extra query, no per-message
// storage. History that predates the feature has null watermarks and reports only
// "sent", never a fabricated delivery.
//
// Kept pure so the boundary math is unit-tested apart from rendering and the
// realtime stream.

export type MessageReceipt = "sent" | "delivered" | "read";

export interface MessageReceiptInfo {
  // The qualifying watermark's epoch millis (read wins over delivered), or null
  // for "sent" and for unparseable timestamps.
  at: number | null;
  status: MessageReceipt;
}

export interface PeerWatermarks {
  // Epoch millis of the peer's delivery watermark, or null when never acked.
  deliveredAt: number | null;
  // Epoch millis of the peer's read watermark, or null when never read.
  readAt: number | null;
}

export const EMPTY_WATERMARKS: PeerWatermarks = {
  deliveredAt: null,
  readAt: null,
};

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

// The receipt of one message. Only own messages carry a receipt; a received
// message returns null (the recipient has nothing to confirm to itself). A message
// with an unparseable timestamp degrades to "sent" with no time rather than
// claiming a delivery it cannot verify.
export function getMessageReceipt(params: {
  createdAt: Date | string;
  mine: boolean;
  watermarks: PeerWatermarks;
}): MessageReceiptInfo | null {
  if (!params.mine) {
    return null;
  }
  const created = toTime(params.createdAt);
  if (created === null) {
    return { at: null, status: "sent" };
  }
  if (
    params.watermarks.readAt !== null &&
    params.watermarks.readAt >= created
  ) {
    return { at: params.watermarks.readAt, status: "read" };
  }
  if (
    params.watermarks.deliveredAt !== null &&
    params.watermarks.deliveredAt >= created
  ) {
    return { at: params.watermarks.deliveredAt, status: "delivered" };
  }
  return { at: null, status: "sent" };
}

// A short, human label for the receipt row in the options sheet.
export function receiptLabel(receipt: MessageReceipt): string {
  if (receipt === "read") {
    return "Read";
  }
  if (receipt === "delivered") {
    return "Delivered";
  }
  return "Sent";
}

// Merges a watermark update without ever moving backwards. The realtime stream
// and the initial conversation detail can arrive in either order, and a stale
// event must not retract a receipt.
export function advanceWatermark(
  current: number | null,
  next: number | null
): number | null {
  if (next === null) {
    return current;
  }
  if (current === null) {
    return next;
  }
  return Math.max(current, next);
}

// Reads the peer's watermarks out of the conversation member rows. Tolerant of
// Date or ISO-string values (JSON responses stringify dates) and of a missing peer
// (returns empty, which reports "sent" only).
export function peerWatermarks(
  members:
    | {
        lastDeliveredAt?: Date | string | null;
        lastReadAt?: Date | string | null;
        userId: string;
      }[]
    | undefined,
  myUserId: string | undefined
): PeerWatermarks {
  if (!members || !myUserId) {
    return EMPTY_WATERMARKS;
  }
  const peer = members.find((member) => member.userId !== myUserId);
  if (!peer) {
    return EMPTY_WATERMARKS;
  }
  return {
    deliveredAt: toTime(peer.lastDeliveredAt),
    readAt: toTime(peer.lastReadAt),
  };
}
