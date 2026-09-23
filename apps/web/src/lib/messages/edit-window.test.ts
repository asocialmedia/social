import { describe, expect, test } from "bun:test";

import { isWithinEditWindow, MESSAGE_EDIT_WINDOW_MS } from "./edit-window";

describe("isWithinEditWindow", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  test("allows an edit immediately after sending", () => {
    expect(isWithinEditWindow(new Date(now.getTime() - 1000), now)).toBe(true);
  });

  test("allows an edit exactly at the window boundary", () => {
    expect(
      isWithinEditWindow(new Date(now.getTime() - MESSAGE_EDIT_WINDOW_MS), now)
    ).toBe(true);
  });

  test("rejects an edit one millisecond past the window", () => {
    expect(
      isWithinEditWindow(
        new Date(now.getTime() - MESSAGE_EDIT_WINDOW_MS - 1),
        now
      )
    ).toBe(false);
  });

  test("rejects an edit on an old message", () => {
    expect(
      isWithinEditWindow(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), now)
    ).toBe(false);
  });

  test("tolerates a future createdAt (server-set, so never actually skewed)", () => {
    // createdAt is a server default, so this cannot happen in practice; the
    // negative elapsed is still within the allowance rather than crashing.
    expect(isWithinEditWindow(new Date(now.getTime() + 60_000), now)).toBe(
      true
    );
  });

  test("accepts a serialized ISO string, as rows arrive on the wire", () => {
    expect(
      isWithinEditWindow(new Date(now.getTime() - 1000).toISOString(), now)
    ).toBe(true);
    expect(
      isWithinEditWindow(
        new Date(now.getTime() - MESSAGE_EDIT_WINDOW_MS - 1).toISOString(),
        now
      )
    ).toBe(false);
  });

  test("fails closed on an unparseable timestamp", () => {
    expect(isWithinEditWindow("not a date", now)).toBe(false);
  });
});
