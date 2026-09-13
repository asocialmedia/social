import { describe, expect, test } from "bun:test";

import {
  getSessionDevice,
  getSessionLocation,
  isSecuritySession,
} from "./security-session-utils";

describe("security session helpers", () => {
  test("identifies an active session summary without requiring its secret token", () => {
    expect(
      isSecuritySession({
        createdAt: "2026-09-10T00:00:00.000Z",
        expiresAt: "2026-09-17T00:00:00.000Z",
        id: "session-id",
        ipAddress: "203.0.113.10",
        updatedAt: "2026-09-10T00:00:00.000Z",
        userAgent: "Mozilla/5.0 Chrome/140.0",
      })
    ).toBe(true);
  });

  test("derives a readable browser and device label", () => {
    expect(
      getSessionDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0"
      )
    ).toEqual({ browser: "Chrome", device: "Mac" });
    expect(getSessionDevice(null)).toEqual({
      browser: "Unknown browser",
      device: "Unknown device",
    });
  });

  test("shows only country-level location with the recorded network address", () => {
    expect(getSessionLocation("IN", "203.0.113.10")).toBe(
      "India · 203.0.113.10"
    );
  });
});
