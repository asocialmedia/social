import { describe, expect, test } from "bun:test";

import {
  getSessionDevice,
  getSessionLocation,
  formatLastActive,
  sessionDeviceLabel,
} from "./session-labels";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

describe("getSessionDevice", () => {
  test("reads the browser and the platform apart", () => {
    expect(getSessionDevice(CHROME_ANDROID)).toEqual({
      browser: "Chrome",
      device: "Android device",
    });
    expect(getSessionDevice(EDGE_WINDOWS)).toEqual({
      browser: "Microsoft Edge",
      device: "Windows",
    });
    expect(getSessionDevice(FIREFOX_LINUX)).toEqual({
      browser: "Firefox",
      device: "Linux device",
    });
  });

  test("prefers Safari over Chrome for an iPhone, matching web's order", () => {
    // A Safari iPhone UA also contains "Safari/", so the ordering matters.
    expect(getSessionDevice(SAFARI_IPHONE)).toEqual({
      browser: "Safari",
      device: "iPhone",
    });
  });

  test("reports CriOS as Chrome", () => {
    expect(getSessionDevice("Mozilla/5.0 CriOS/120.0 Mobile").browser).toBe(
      "Chrome"
    );
  });

  test("degrades both halves for an unrecognised agent", () => {
    expect(getSessionDevice(null)).toEqual({
      browser: "Unknown browser",
      device: "Unknown device",
    });
    expect(getSessionDevice("curl/8.0")).toEqual({
      browser: "Unknown browser",
      device: "Unknown device",
    });
  });
});

describe("sessionDeviceLabel", () => {
  test("joins the two halves when both are known", () => {
    expect(sessionDeviceLabel(CHROME_ANDROID)).toBe("Chrome on Android device");
  });

  test("uses whichever half is known rather than printing Unknown", () => {
    expect(sessionDeviceLabel("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
    expect(sessionDeviceLabel("Chrome/120.0.0.0")).toBe("Chrome");
    expect(sessionDeviceLabel(null)).toBe("Unknown device");
  });
});

describe("getSessionLocation", () => {
  test("keeps real city names consisting of hexadecimal letters", () => {
    expect(getSessionLocation("US", " Ada ")).toBe("Ada, United States");
    expect(getSessionLocation("DE", "2001:db8::1")).toBe("Germany");
    expect(getSessionLocation("IN", " ")).toBe("India");
  });
  test("joins the country name and the address when both are present", () => {
    expect(getSessionLocation("DE", "203.0.113.7")).toBe("Germany");
  });

  test("falls back to whichever half exists", () => {
    expect(getSessionLocation("JP", null)).toBe("Japan");
    expect(getSessionLocation(null, "198.51.100.4")).toBe(
      "Location unavailable"
    );
  });

  test("says so honestly when neither is available", () => {
    expect(getSessionLocation(null, null)).toBe("Location unavailable");
  });

  test("does not throw on an unknown region code", () => {
    expect(() => getSessionLocation("ZZ", null)).not.toThrow();
  });
});

describe("formatLastActive", () => {
  const now = Date.parse("2026-09-26T12:00:00.000Z");

  test("scales the wording with the gap", () => {
    expect(formatLastActive("2026-09-26T11:59:30.000Z", now)).toBe("just now");
    expect(formatLastActive("2026-09-26T11:45:00.000Z", now)).toBe("15m ago");
    expect(formatLastActive("2026-09-26T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatLastActive("2026-09-24T12:00:00.000Z", now)).toBe("2d ago");
  });

  test("falls back to a real date past a month", () => {
    const old = "2026-01-01T12:00:00.000Z";
    expect(formatLastActive(old, now)).toBe(new Date(old).toLocaleDateString());
  });

  test("reports unknown for a missing or unparseable date", () => {
    expect(formatLastActive(null, now)).toBe("unknown");
    expect(formatLastActive("not a date", now)).toBe("unknown");
  });

  test("never reports a negative age for a clock skew", () => {
    expect(formatLastActive("2026-09-26T12:30:00.000Z", now)).toBe("just now");
  });
});

test("native sessions identify the actual model and show coarse city without an address", () => {
  expect(sessionDeviceLabel("Asocialmedia/0.1.72 (Android 16; Pixel 9)")).toBe(
    "Asocialmedia on Pixel 9"
  );
  expect(getSessionLocation("IN", "Betul")).toBe("Betul, India");
});
