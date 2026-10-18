import { describe, expect, test } from "bun:test";

import {
  formatViewOnceSeenAt,
  isViewOnceUnavailable,
  retryViewOnceReceipt,
  viewOnceReceiptKey,
} from "./view-once";

describe("view-once receipts", () => {
  test("formats an actual view time and omits invalid or absent times", () => {
    const stamp = "2026-10-18T11:42:00.000Z";
    expect(formatViewOnceSeenAt(stamp)).toBe(
      `Seen at ${new Date(stamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    );
    expect(formatViewOnceSeenAt(null)).toBeNull();
    expect(formatViewOnceSeenAt("invalid")).toBeNull();
  });
  test("isolates receipt caches by account and conversation", () => {
    expect(viewOnceReceiptKey("one", "chat", "photo")).not.toEqual(
      viewOnceReceiptKey("two", "chat", "photo")
    );
    expect(viewOnceReceiptKey("one", "chat", "photo")).not.toEqual(
      viewOnceReceiptKey("one", "other", "photo")
    );
  });
  test("recognizes unavailable photos without treating outages as deletions", () => {
    expect(isViewOnceUnavailable({ status: 404 })).toBe(true);
    expect(isViewOnceUnavailable({ status: 410 })).toBe(true);
    expect(isViewOnceUnavailable({ status: 503 })).toBe(false);
    expect(isViewOnceUnavailable(null)).toBe(false);
  });
  test("retries transient failures with a fixed bound, and stops on access denial", () => {
    expect(retryViewOnceReceipt(0, { status: 403 })).toBe(false);
    expect(retryViewOnceReceipt(0, { status: 404 })).toBe(false);
    expect(retryViewOnceReceipt(0, { status: 429 })).toBe(true);
    expect(retryViewOnceReceipt(4, new Error("Offline"))).toBe(true);
    expect(retryViewOnceReceipt(5, new Error("Offline"))).toBe(false);
  });
});
