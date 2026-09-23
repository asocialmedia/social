import { describe, expect, test } from "bun:test";

import {
  advanceWatermark,
  EMPTY_WATERMARKS,
  getMessageReceipt,
  peerWatermarks,
  receiptLabel,
} from "./message-receipts";

const T0 = new Date("2026-06-15T12:00:00.000Z").getTime();

describe("getMessageReceipt", () => {
  test("returns null for a received message", () => {
    expect(
      getMessageReceipt({
        createdAt: new Date(T0),
        mine: false,
        watermarks: { deliveredAt: T0 + 1, readAt: T0 + 1 },
      })
    ).toBeNull();
  });

  test("reports sent when the peer has not acked", () => {
    expect(
      getMessageReceipt({
        createdAt: new Date(T0),
        mine: true,
        watermarks: EMPTY_WATERMARKS,
      })
    ).toEqual({ at: null, status: "sent" });
  });

  test("reports delivered once the watermark reaches the message", () => {
    // `at` is the delivery watermark that qualified the message.
    expect(
      getMessageReceipt({
        createdAt: new Date(T0),
        mine: true,
        watermarks: { deliveredAt: T0, readAt: null },
      })
    ).toEqual({ at: T0, status: "delivered" });
    // A watermark older than the message does not count.
    expect(
      getMessageReceipt({
        createdAt: new Date(T0),
        mine: true,
        watermarks: { deliveredAt: T0 - 1, readAt: null },
      })
    ).toEqual({ at: null, status: "sent" });
  });

  test("read wins over delivered and reports the read watermark", () => {
    expect(
      getMessageReceipt({
        createdAt: new Date(T0),
        mine: true,
        watermarks: { deliveredAt: T0, readAt: T0 + 5000 },
      })
    ).toEqual({ at: T0 + 5000, status: "read" });
  });

  test("accepts JSON ISO strings", () => {
    expect(
      getMessageReceipt({
        createdAt: "2026-06-15T12:00:00.000Z",
        mine: true,
        watermarks: { deliveredAt: T0 + 5000, readAt: null },
      })
    ).toEqual({ at: T0 + 5000, status: "delivered" });
  });

  test("fails safe to sent with no time on an unparseable timestamp", () => {
    expect(
      getMessageReceipt({
        createdAt: "nope",
        mine: true,
        watermarks: { deliveredAt: T0, readAt: T0 },
      })
    ).toEqual({ at: null, status: "sent" });
  });
});

describe("receiptLabel", () => {
  test("maps each state to a human label", () => {
    expect(receiptLabel("sent")).toBe("Sent");
    expect(receiptLabel("delivered")).toBe("Delivered");
    expect(receiptLabel("read")).toBe("Read");
  });
});

describe("advanceWatermark", () => {
  test("never moves backwards", () => {
    expect(advanceWatermark(100, 50)).toBe(100);
    expect(advanceWatermark(100, 150)).toBe(150);
  });

  test("adopts a first value and ignores null updates", () => {
    expect(advanceWatermark(null, 42)).toBe(42);
    expect(advanceWatermark(42, null)).toBe(42);
    expect(advanceWatermark(null, null)).toBeNull();
  });
});

describe("peerWatermarks", () => {
  test("reads the other member and parses ISO strings", () => {
    const marks = peerWatermarks(
      [
        { lastDeliveredAt: null, lastReadAt: null, userId: "me" },
        {
          lastDeliveredAt: "2026-06-15T12:00:01.000Z",
          lastReadAt: "2026-06-15T12:00:02.000Z",
          userId: "peer",
        },
      ],
      "me"
    );
    expect(marks.deliveredAt).toBe(T0 + 1000);
    expect(marks.readAt).toBe(T0 + 2000);
  });

  test("returns empty when there is no peer or no user", () => {
    expect(peerWatermarks([{ userId: "me" }], "me")).toEqual(EMPTY_WATERMARKS);
    expect(peerWatermarks(undefined, "me")).toEqual(EMPTY_WATERMARKS);
    expect(peerWatermarks([{ userId: "peer" }])).toEqual(EMPTY_WATERMARKS);
  });
});
