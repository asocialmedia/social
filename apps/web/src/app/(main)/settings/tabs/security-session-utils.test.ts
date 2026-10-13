import { describe, expect, test } from "bun:test";

import {
  getSessionDevice,
  getSessionLocation,
  isSecuritySession,
  sessionDeviceLabel,
  sessionClientLabel,
  hasSessionRefresh,
} from "./security-session-utils";

describe("security session helpers", () => {
  test("distinguishes native apps, mobile browsers, previews and test browsers", () => {
    expect(
      sessionDeviceLabel("Asocialmedia/0.1.89 (Android 16; Pixel 9)")
    ).toBe("asocialmedia app on Pixel 9");
    expect(
      sessionClientLabel("Asocialmedia/0.1.89 (Android 16; Pixel 9)")
    ).toBe("Android app · v0.1.89");
    expect(sessionClientLabel("Asocialmedia/1.2 (iOS 26; iPhone 16)")).toBe(
      "iOS app · v1.2"
    );
    expect(
      sessionDeviceLabel(
        "Mozilla/5.0 (Linux; Android 16) Chrome/152 Mobile Safari/537"
      )
    ).toBe("Chrome on Android");
    expect(
      sessionClientLabel(
        "Mozilla/5.0 (Linux; Android 16) Chrome/152 Mobile Safari/537"
      )
    ).toBe("Web browser");
    expect(
      sessionDeviceLabel(
        "Mozilla/5.0 (X11; Linux x86_64) T3Code(Alpha)/0.0.45 Chrome/152 Electron/44"
      )
    ).toBe("T3 Code preview on Linux");
    expect(
      sessionDeviceLabel(
        "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/155 Safari/537"
      )
    ).toBe("Chrome test browser on Linux");
    expect(sessionDeviceLabel("okhttp/4.12.0")).toBe("Android app client");
  });

  test("missing location placeholders and duplicate initial timestamps stay out of the UI", () => {
    expect(
      getSessionLocation(null, "0000:0000:0000:0000:0000:0000:0000:0000")
    ).toBe("Location unavailable");
    expect(getSessionLocation("T1", null)).toBe("Location unavailable");
    expect(getSessionLocation("IN", "Betul")).toBe("Betul, India");
    expect(
      hasSessionRefresh("2026-10-13T17:00:00Z", "2026-10-13T17:00:00Z")
    ).toBe(false);
    expect(
      hasSessionRefresh("2026-10-13T17:00:00Z", "2026-10-14T17:00:00Z")
    ).toBe(true);
  });
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

  test("shows a coarse location without exposing a network address", () => {
    expect(getSessionLocation("IN", "203.0.113.10")).toBe("India");
  });
});
